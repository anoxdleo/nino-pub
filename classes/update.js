const {Editor} = require('./lists')
const Magnet = require('./magnet')
const path = require('path')
const DriveHandler = require('./driveHandler')
const {db, type, insert, Op, update} = require('../base/sqlize')
const {
    pageTwo,
    getExternalId,
    getTrailer,
    search,
    fanArtImages,
    getDetails,
    tmdbIMages,
    getCollection
} = require('../base/tmdb-hook')
const OS = require('opensubtitles-api')
let OpenSubtitles = null;
const rename = require('locutus/php/strings/strtr');
const {log: ln, aJax, sFetch} = require("../base/baseFunctions")
const {movies, tvShows, backdrop} = require('../config/nino.json').library
const drive = new DriveHandler();
const log = (pos, info) => ln(pos, 'update', info);

if (require('../config/nino.json').openSubtitles !== null) {
    const {useragent, password, username} = require('../config/nino.json').openSubtitles
    OpenSubtitles = new OS({useragent, username, password, ssl: true});
}

let dicDo = {
    " (1080p HD).m4v": "", " (HD).m4v": "", " (4K).m4v": "",
    "_": "", ".mp4": "", ".m4v": "", "-": "", "264": "",
    "1080p": "", "BluRay": "", "YIFY": "", "x264": "", "HDDVD": "",
    "BrRip": "", "[": "", "]": "", "AG": "", "AM": "",
    "YTS": "", "AAC5.1": "", "MX": "", "LT": "", "2011": "",
    "ECE": "", "bitloks": "", "Extended": "", "Bluray": "", "WEB": "",
    "+HI": "", "WEBRip": "", "BRrip": "", "GAZ": "", "720p": "",
    "1968": "", "AAC": "", "ExD": "", "THEATRICAL": "", "EDITION": "",
    "(": "", ")": "", "2160p": "", "4K": "", "x265": "", "10bit": "",
    "EXTENDED": "", "RARBG": "", "anoXmous": "",
    "Deceit": "", "BOKUTOX": "", " ( FIRST TRY)": "", "IMAX": "",
    "UNRATED": "", "BrRIp": "", "AAC2": "", "0PRiNCE": "", "Brrip": "",
    ".": " ", "Directors Cut": "", "DIRECTORS.CUT": "",
};

const Sub = db.define('subs', {
    type: {
        type: type.BOOLEAN,
        defaultValue: false
    }, sub: {
        type: type.BIGINT(20),
        allowNull: false
    }
})

Sub.sync().catch(err => console.error(err));
const subs = {eng: '', fre: '', ger: ''};

class Update extends Magnet {
    /**
     * @desc scans the library for a new file / folder and adds it to the database
     * @param type
     * @returns {Promise<{}|boolean>}
     */
    async findEntry(type) {
        let location = type === "movie" ? movies : tvShows;
        let folder = await drive.readFolder(location);
        let model = type === "movie" ? db.models.movie : db.models.show;

        let response = false;
        for (const item of folder) {
            let entry = await model.findOne({where: {gid: item.id}});
            if (entry === null) {
                response = item;
                break;
            }
        }

        if (response !== false) {
            let regex = /(?<name>^.*?(?=(?<date_one>\d+).\d+p[^"]+|\.?\(?(?<date_two>\d{4})))/;
            let matches = response.name.match(regex)
            let name = type === "movie" && matches !== null ? matches.groups.name : response.name;
            let year = (type === "movie" && matches !== null) && (matches.groups.date_one || matches.groups.date_two) ? matches.groups.date_one ? matches.groups.date_one : matches.groups.date_two : false;
            name = rename(name, dicDo);
            response = {
                link: response.id,
                year, name
            }
        }
        return response;
    }

    /**
     * @desc adds a list of entries to database
     * @param name
     * @param ids
     * @param display
     * @param selected
     * @returns {Promise<{list: *[], selected: *[]}>}
     */
    async addList(name, ids, display, selected) {
        let editor = new Editor();
        await db.models.editor.destroy({where: {category: name}});
        await editor.setPick(selected);

        for (const id of ids)
            await editor.addItem(name, display, id);

        return await this.getLists();
    }

    /**
     * @desc gets the list of all categories
     * @returns {Promise<{list: *[], selected: *[]}>}
     */
    async getLists() {
        let result = await db.models.editor.findAll({attributes: ['category']});
        let editors = await db.models.pick.findAll();
        return {
            list: result.uniqueID('category').map(item => {
                return item.category
            }), selected: editors.map(item => {
                return item.name
            })
        };
    }

    /**
     * @desc handles the recognition and storing of each episode file
     * @param boolean
     * @param file
     * @param show
     * @param season
     * @param previous
     * @param season_id
     * @param check
     * @returns {Promise<{previous: number, check}>}
     */
    async handleEpisode(boolean, file, show, season, previous, season_id, check) {
        let ext = path.extname(file.name)
        if ((ext === '.mp4' || ext === '.m4v') && file.mimeType !== 'application/vnd.google-apps.folder') {
            let name = rename(file.name, dicDo);
            let matches = name.match(/s(?<season>\d+).*?e(?<episode>\d+)/i);
            if (matches === null) {
                matches = name.match(/\d{2}/g);
                let index = /^\d{2}/.test(name) || /e\d{2}.*?e\d{2}/i ? 0 : matches.length - 1;
                matches = matches && matches.length ? {groups: {episode: matches[index]}} : null;
                if (/\d{3}/.test(name) && !/^\d{2}/.test(name))
                    matches = name.match(/(?<season>\d)(?<episode>\d{2})/);

                if (matches === null) {
                    await this.renameAndScan(season.id, show, season_id);
                    return {check, previous, break: true}
                }
            }

            if (matches) {
                let eID = matches.groups.episode;
                season_id = season_id === undefined && matches.groups.season ? matches.groups.season : season_id;
                let episode_id = parseInt(`${show.id}` + season_id + eID);

                if (season_id === undefined)
                    return {check, previous};

                if (previous !== episode_id) {
                    previous = episode_id;

                    let checkers = check.find(item => item.episode_id === episode_id && item.gid === file.id);
                    check = check.filter(item => !(item.episode_id === episode_id && item.gid === file.id));

                    if (checkers === undefined) {
                        let episode = {
                            show_id: show.id,
                            season_id: parseInt(season_id),
                            episode: parseInt(eID),
                            gid: file.id,
                            episode_id: episode_id
                        }

                        let cond = {episode_id}
                        episode = {...episode, ...subs};
                        await insert(db.models.episode, episode, cond)
                        if (boolean) {
                            show.changed('updatedAt', true);
                            await show.update({updatedAt: new Date()});
                        }
                        let obj = {sub: episode_id, type: 0};
                        checkers = await Sub.findAll();
                        await Sub.create(obj);
                        if (checkers.length < 1) await this.loadSubs();
                    }
                } else {
                    await this.renameAndScan(season.id, show, season_id);
                    return {check, previous, break: true}
                }
            }
        } else
            await drive.deleteFile(file.id)

        return {check, previous}
    }

    /**
     * @desc scans, renames and saves files in a season folder that might be difficult for scanEpisodes
     * @param folder
     * @param show
     * @param season_id
     * @returns {Promise<void>}
     */
    async renameAndScan(folder, show, season_id) {
        let files = await drive.readFolder(folder);
        let episodes = await db.models.episode.findAll({where: {show_id: show.id, season_id}, raw: true})
        let temp = (season_id > 9 ? '' : '0') + season_id;

        for (let i = 0; i < files.length; i++) {
            let ext = path.extname(files[i].name)
            let episode = (i + 1 > 9 ? '' : '0') + (i + 1);
            let matches = rename(files[i].name, dicDo).match(/\d{2}|\d/g);
            episode = matches && matches.length ? matches[matches.length - 1] : episode;
            let name = `${show.name} S${temp}E${episode}${ext}`;
            await drive.renameFile(files[i].id, name);
            let obj = {
                ...{
                    gid: files[i].id,
                    episode: parseInt(episode),
                    show_id: show.id, season_id: parseInt(season_id),
                    episode_id: parseInt(`${show.id}${season_id}${episode}`)
                }, ...subs
            }
            episodes = episodes.filter(item => item.episode_id !== obj.episode_id);
            await insert(db.models.episode, obj, {episode_id: obj.episode_id});
        }

        for (let file of episodes) {
            let episode = await db.models.episode.findOne({where: {episode_id: file.episode_id, gid: file.gid}})
            if (episode)
                await episode.destroy();
        }
    }

    /**
     * @desc Attempts to clean the movie db by removing files that might hav an error and attempting to re-download them at the same time
     * @returns {Promise<void>}
     */
    async cleanHouse() {
        let movies = await db.models.movie.findAll();
        for (let item of movies) {
            let temp = await drive.getFile(item.gid);
            if (temp.hasOwnProperty('error')) {
                let response = await this.getTMdbMagnet('m' + item.tmdb_id);
                if (response.hasOwnProperty('url')) {
                    await this.downloadTorrent(response.url)
                }
                await item.destroy();
            }
        }
    }

    /**
     * @desc scans the library for new seasons and episodes
     * @returns {Promise<void>}
     */
    async scanEpisodes(boolean) {
        let shows = await db.models.show.findAll({order: [['id', 'DESC']]});
        for (let show of shows) {
            log(131, 'scanning ' + show.name)
            let episodes = await db.models.episode.findAll({
                where: {show_id: show.id},
                attributes: ['season_id', 'episode', "episode_id", "gid"],
                raw: true
            });
            let seasons = await drive.readFolder(show.gid);

            if (boolean) {
                let seasons = episodes.uniqueID('season_id');
                let tvShow = await getDetails(0, show.tmdb_id);
                if (tvShow.number_of_seasons === seasons.length && tvShow.number_of_episodes === episodes.length)
                    continue;
            }

            for (const season of seasons) {
                if (season.mimeType === 'application/vnd.google-apps.folder') {
                    let files = await drive.readFolder(season.id);
                    let matches = season.name.match(/^Season\s(?<season>\d+)/i);

                    let previous;
                    if (matches === null)
                        continue;

                    let season_id = matches.groups.season;
                    if (season.name !== 'Season ' + parseInt(season_id))
                        await drive.renameFile(season.id, 'Season ' + parseInt(season_id))

                    let check = episodes.filter(item => item.season_id === parseInt(season_id))
                    if (boolean && check.length === files.length)
                        continue;

                    for (const file of files) {
                        let obj = await this.handleEpisode(boolean, file, show, season, previous, season_id, check)
                        check = obj.check;
                        previous = obj.previous;
                        if (obj.hasOwnProperty('break'))
                            break;
                    }
                    if (check.length) {
                        for (let item of check) {
                            let entry = await db.models.episode.findOne({
                                where: {
                                    episode_id: item.episode_id,
                                    gid: item.gid
                                }
                            });
                            if (entry)
                                await entry.destroy();
                        }
                    }
                } else
                    await this.handleEpisode(boolean, season, show, undefined, undefined, undefined, []);
            }
        }
        if (!boolean)
            await this.cleanHouse();
    }

    /**
     * @desc adds an entry to the database after user intervention from the user and also scans for the next entry on present library
     * @param obj
     * @returns {Promise<{}|boolean>}
     */
    async updateEntry(obj) {
        let item = {
            name: obj.name, backdrop: obj.backdrop, poster: obj.poster, gid: obj.gid,
            tmdb_id: parseInt(obj.id), type: obj.type === "movie", logo: obj.logo
        }

        if (item.type)
            item.movie_id = new Date().getTime();

        item.trailer = await getTrailer(item.tmdb_id, item.type ? 1 : 0);
        item = {...item, ...subs};
        let cond = {tmdb_id: item.tmdb_id};
        let model = item.type ? db.models.movie : db.models.show;
        let upd = await insert(model, item, cond);
        if (upd.hasOwnProperty('item') && item.type) {
            let obj = {sub: upd.item.movie_id, type: 1};
            let check = await Sub.findAll();
            await Sub.create(obj);
            if (check.length < 1) await this.loadSubs();
        }

        let type = item.type ? 'movie' : 'show';
        return await this.findEntry(type);
    }

    /**
     * @desc this is a recursive function that handles the subtitles logic
     * @returns {Promise<void>}
     */
    async loadSubs() {
        let subs = await Sub.findAll({raw: true});
        await Sub.destroy({where: {id: {[Op.gt]: 0}}});
        log(90, 'in')
        if (subs.length > 0) {
            let obj = subs[0];
            subs.shift();

            subs = subs.map(sub => {
                delete sub.id;
                return sub;
            });

            if (subs.length)
                await Sub.bulkCreate(subs);

            let result = await this.getSub(obj.sub, obj.type);
            let model = obj.type === 1 ? db.models.movie : db.models.episode;
            let cond = obj.type === 1 ? {movie_id: obj.sub} : {episode_id: obj.sub};
            let table = obj.type === 1 ? 'movies' : 'episodes';
            let item = await model.findOne({where: cond})
            if (item) {
                item = item.get();
                ['eng', 'fre', 'ger'].forEach(e => delete item[e]);
                item = {...item, ...result};
                await update(table, table.replace(/s$/, '_id'), obj.sub, item);
                log(58, obj.sub + ' from ' + (obj.type === 0 ? 'episodes' : 'movies') + ' has been updated');
                setTimeout(async () => await this.loadSubs(), 1000);
            }
        } else
            log(64, 'done');
    }

    /**
     * @desc gets the subs for a specific entry
     * @param file_id
     * @param type
     * @returns {Promise<{ger: string, fre: string, eng: string}>}
     */
    async getSub(file_id, type) {
        if (OpenSubtitles !== null) {
            let obj;
            if (type === 0) {
                let entry = await db.models.episode.findOne({
                    where: {episode_id: file_id},
                    include: [{model: db.models.show, attributes: ['tmdb_id']}]
                });

                if (entry) {
                    let {season_id, episode, gid} = entry.get();
                    let file = await drive.getFile(gid);
                    let {imdb_id} = await getExternalId(entry.show.get('tmdb_id'), 0);
                    obj = {
                        season: season_id,
                        filesize: file.size,
                        filename: file.name,
                        episode: episode,
                        imdbid: imdb_id
                    };
                }

            } else {
                let entry = await db.models.movie.findOne({where: {movie_id: file_id}})
                if (entry) {
                    let {gid, tmdb_id} = entry.get();
                    let file = await drive.getFile(gid);
                    let {imdb_id} = await getExternalId(tmdb_id, 1);
                    obj = {filesize: file.size, filename: file.name, imdbid: imdb_id};
                }
            }

            if (obj) {
                obj.extensions = ['srt', 'vtt'];
                let keys = ['en', 'fr', 'de'];
                let lang = ['eng', 'fre', 'ger'];
                return await OpenSubtitles.search(obj)
                    .then(temp => {
                        if (temp !== undefined) {
                            let item = {};
                            keys.forEach((value, pos) => {
                                item[lang[pos]] = temp[value] === undefined ? '' : temp[value].url;
                            });
                            return item;
                        } else return subs;
                    }).catch(error => {
                        console.log(error);
                        return subs;
                    })
            }
        } else
            log(433, 'OpenSubtitles has not yet been set up on this device, consider doing so');
        return subs;
    }

    /**
     * @desc confirms if a movie already exists
     * @param info_id
     * @returns {Promise<{data: ({}|boolean), absent: boolean}|{absent: boolean}>}
     */
    async confirm(info_id) {
        let check = info_id.charAt(0) === "m";
        let model = check ? db.models.movie : db.models.show;
        let entry = await model.findOne({where: {tmdb_id: info_id.replace(/m|s/, '')}});
        if (entry) {
            return {absent: false, location: entry.get('gid')};

        } else return {absent: true};
    }

    /**
     * @desc deletes an entry
     * @param file_id
     * @param type
     * @returns {Promise<{}|boolean>}
     */
    async delete(file_id, type) {
        await drive.deleteFile(file_id);
        return await this.findEntry(type);
    }

    /**
     * @desc updates the meta backdrop images from the backdrop google drive folder provided
     * @returns {Promise<void>}
     */
    async getBackdrops() {
        let files = await drive.readFolder(backdrop);
        files = files.map(img => {
            img.gid = img.id;
            delete img.id;
            return img;
        })

        await db.models.backdrop.destroy({where: {id: {[Op.gt]: 0}}});
        await db.models.backdrop.bulkCreate(files);
    }

    /**
     * @desc searches TMDB by name for an entry
     * @param type
     * @param name
     * @returns {Promise<*>}
     */
    async searchTMDB(type, name) {
        return await search(parseInt(type), name);
    }

    /**
     * @desc returns a list of recommended movies / tv shows for info_id from TMDB
     * @param info_id
     * @returns {Promise<{tmdb_id: *, overview: *, backdrop: string, name: *}[]>}
     */
    async jsonRec(info_id) {
        let check = info_id.charAt(0) === "m";
        let tmdb_id = info_id.replace(/m|s/, "");
        let type = check ? 1 : 0;

        let entry = await getDetails(check ? 1 : 0, tmdb_id);
        let temp = [];
        if (entry.hasOwnProperty('belongs_to_collection') && entry.belongs_to_collection !== null) {
            let {parts} = await getCollection(entry.belongs_to_collection.id);
            temp = parts.map(entry => {
                return {
                    name: check ? entry.title : entry.name, tmdb_id: (check ? 'm' : 's') + entry.id,
                    overview: entry.overview, backdrop: 'https://image.tmdb.org/t/p/original' + entry.backdrop_path
                }
            })
        }

        entry = [{
            name: check ? entry.title : entry.name, tmdb_id: (check ? 'm' : 's') + entry.id,
            overview: entry.overview, backdrop: 'https://image.tmdb.org/t/p/original' + entry.backdrop_path
        }].concat(temp);

        let recommendations = await pageTwo(type, tmdb_id, [], 1, 8, true);
        return entry.concat(recommendations.map(file => {
            return {
                name: check ? file.title : file.name,
                tmdb_id: (check ? 'm' : 's') + file.id,
                overview: file.overview,
                backdrop: 'https://image.tmdb.org/t/p/original' + file.backdrop_path
            };
        })).uniqueID('tmdb_id');
    }

    /**
     * @desc scans the library for items lacking subs and attempts to add subs to these items
     * @returns {Promise<void>}
     */
    async scanSubs(ultra) {
        ultra = ultra || false;
        await Sub.destroy({where: {id: {[Op.gt]: 0}}});
        let movies;
        let episodes;

        if (ultra) {
            movies = await db.models.movie.findAll();
            episodes = await db.models.episode.findAll();
        } else {
            movies = await db.models.movie.findAll({where: {eng: ''}, order: [['updatedAt', 'DESC']]});
            episodes = await db.models.episode.findAll({where: {eng: ''}, order: [['updatedAt', 'DESC']]});
        }

        movies = movies.map(item => {
            return {sub: item.get('movie_id'), type: 1}
        });

        episodes = episodes.map(item => {
            return {sub: item.get('episode_id'), type: 0};
        });

        let obj = movies.concat(episodes);
        let check = await Sub.findAll();
        await Sub.bulkCreate(obj);
        if (check.length < 1) await this.loadSubs();
    }

    /**
     * @desc gets the next season for all possible shows on the database if available
     * @returns {Promise<void>}
     */
    async getNextSeason(value, missing) {
        let shows = await db.models.show.findAll({order: [['id', 'DESC']]});

        for (let item of missing) {
            let info = (item.type ? 'm': 's') + item.tmdb_id;
            let file = await this.getTMdbMagnet(info, value);
            if (file.hasOwnProperty('url'))
                await this.downloadTorrent(file.url)
        }

        for (let item of shows) {
            item = item.get();
            let file = await this.getTMdbMagnet('s' + item.tmdb_id, value);
            if (file.hasOwnProperty('url'))
                await this.downloadTorrent(file.url)
        }
    }

    /**
     * @desc searches several DBs for images for a show || movie
     * @param tmdb_id
     * @param type
     * @returns {Promise<{apple: [], release_date: *, name: *, nino: null}>}
     */
    async getImages(type, tmdb_id) {
        let int = -1;
        let res = {apple: [], nino: null};
        type = parseInt(`${type}`);
        let storefront = [143441, 143444, 143442, 143443];
        let {title, name, release_date} = await getDetails(type, tmdb_id);
        name = title ? title : name;

        while (res.apple.length < 1 && int < storefront.length - 1) {
            int++;
            let data = {query: name, storefront: storefront[int], locale: "en-US"};
            let url = 'https://itunesartwork.bendodson.com/url.php';
            url = (await aJax({method: "POST", url: url}, data)).url;
            url = url.split('search/incremental?');
            url = url[0] + 'search/incremental?sf=' + storefront[int] + '&' + url[1] + '&q=' + name;
            let info = await sFetch(url);
            info = info.data && info.data.canvas && info.data.canvas.shelves ? info.data.canvas.shelves : false;
            if (info) {
                let movies, shows;
                movies = shows = [];
                for (const item of info)
                    if (item.title === 'Movies')
                        movies = item.items;

                    else if (item.title === 'TV Shows')
                        shows = item.items;

                res.apple = parseInt(`${type}`) === 1 ? movies : shows;
            }
        }

        let info = await tmdbIMages(tmdb_id, type);
        let resTwo = await fanArtImages(tmdb_id, type);

        res.nino = {
            name: name,
            backdrop: info.backdrop !== '' ? info.backdrop : resTwo.backdrop,
            poster: info.poster !== '' ? info.poster : resTwo.poster,
            logo: resTwo.logo
        }

        return {...res, ...{name, year: new Date(release_date).getFullYear()}};
    }

    /**
     * @desc makes the data comprehensible by the front end
     * @param type
     * @param tmdb_id
     * @returns {Promise<{apple: *[], release_date: *, name: *, nino: null}>}
     */
    async interpretImages(type, tmdb_id) {
        let response = await this.getImages(type, tmdb_id);
        let category = parseInt(type) === 1 ? 'Movie' : 'Show';
        let info = response.apple.map(item => {
            return {
                name: item.title,
                category: item.type,
                images: item.images,
            }
        });

        info = info.filter(item => item.category === category);
        let result = [];
        for (let item of info) {
            let res = item.images;
            res = {
                poster: res.coverArt16X9 ? res.coverArt16X9 : '',
                backdrop: res.previewFrame ? res.previewFrame : '',
                logo: res.fullColorContentLogo ? res.fullColorContentLogo : res.singleColorContentLogo ? res.singleColorContentLogo : ''
            }

            for (const item in res) {
                let format = '.' + (item === 'logo' ? 'png' : 'jpg');
                let val = res[item];
                let matches = val === '' ? false : val.url.match(/(?<link>.+?)(?=\/{w})/);
                if (matches && matches.groups)
                    res[item] = matches.groups.link + '/' + val.width + 'x' + val.height + format;
            }

            res.name = item.name;
            result.push(res);
        }

        response.apple = result;
        return response;
    }

    /**
     * @desc makes a calculated decision on the right image of an entry for automatic inserts info into database
     * @param type
     * @param tmdb_id
     * @returns {Promise<{trailer: string, tmdb_id: *, backdrop: (*|string), logo: (*|string), type: boolean, poster: (*|string)}|boolean>}
     */
    async sift(type, tmdb_id) {
        let res;
        let category = type === 1 ? 'Movie' : 'Show';
        let response = await this.getImages(type, tmdb_id);
        let trailer = await getTrailer(tmdb_id, type);
        let info = response.apple.map(item => {
            return {
                name: item.title,
                category: item.type,
                images: item.images,
                year: new Date(item.releaseDate).getFullYear()
            }
        });
        let {name, year} = response;

        info = info.length > 1 ? info.filter(item => item.category === category && (year - 1 <= item.year && item.year <= year + 1) && item.name.levenstein(name, 3)): info;

        if (info.length) {
            res = info[0].images;
            res = {
                poster: res.coverArt16X9 ? res.coverArt16X9 : '',
                backdrop: res.previewFrame ? res.previewFrame : '',
                logo: res.fullColorContentLogo ? res.fullColorContentLogo : res.singleColorContentLogo ? res.singleColorContentLogo : ''
            }

            for (const item in res) {
                let format = '.' + (item === 'logo' ? 'png' : 'jpg');
                let val = res[item];
                let matches = val === '' ? false : val.url.match(/(?<link>.+?)(?=\/{w})/);
                if (matches && matches.groups)
                    res[item] = matches.groups.link + '/' + val.width + 'x' + val.height + format;
            }

            res.name = info[0].name;
        } else res = response.nino;

        res = {...res, ...{tmdb_id, trailer, type: type === 1}};
        for (let item in res)
            if (res[item] === '' && !['logo', 'tmdb_id', 'type', 'trailer'].some(key => key === item))
                return false;

        return res;
    }

    /**
     * @desc [BETA] Attempts to scan the libraries for new entries
     * @returns {Promise<void>}
     */
    async autoScan() {
        let films = await drive.readFolder(movies);
        let shows = await drive.readFolder(tvShows);

        for (let item of films) {
            let entry = await db.models.movie.findOne({where: {gid: item.id}});
            if (entry === null) {
                let name, year;
                let regex = /(?<name>^.*?)\.(?<year>\d{4})\.\d+p[^"]+/
                let matches = item.name.match(regex);

                if (matches){
                    name = matches.groups.name;
                    year = matches.groups.year;
                    name = rename(name, dicDo);

                } else {
                    name = item.name.match(/(?<name>^.*?)\d+p/);
                    name = name && name.groups.name ? name.groups.name: item.name;
                    name = rename(name, dicDo);
                    year = name.match(/\d{4}/g);
                    year = year && year.length ? year[year.length- 1] : new Date().getFullYear();
                    name = name.replace(year, '');
                }

                year = parseInt(`${year}`);

                let backup = [], results;
                results = (await u.searchTMDB('1', name)).results;
                if (results.length < 1) continue;
                results = results.map(item => {
                    return {
                        tmdb_id: item.id,
                        name: item.title,
                        popularity: item.popularity,
                        backdrop: item.backdrop_path,
                        year: new Date(item.release_date).getFullYear()
                    }
                })

                for (let item of results) {
                    if ((year-1 <= item.year && item.year <= year +1) && (name.strip(item.name) || item.name.levenstein(name, 5)))
                        backup.push(item);
                }

                backup = backup.length > 1 ? backup.filter(item => item.year === year && item.name.levenstein(name, 3)): backup;
                backup = backup.length > 1 ? backup.filter(item => item.name.levenstein(name, 2)): backup;
                backup = backup.length > 1 ? backup.filter(item => item.name.levenstein(name, 1)): backup;

                if (backup.length < 1 && year === new Date().getFullYear()){
                    backup = results.filter(item => item.backdrop !== null).map(item => {
                        item.drift = item.name.levenstein(name);
                        return item
                    }).sortKeys('drift', 'popularity', true, false);
                    backup = [backup[0]];
                }

                [backup, results] = [results, backup];
                if (results.length === 1 || backup.length === 1) {
                    let obj = results.length ? results[0]: backup[0];
                    obj = await this.sift(1, obj.tmdb_id);
                    if (obj !== false) {
                        obj = {...obj, ...subs};
                        obj.gid = item.id;
                        obj.movie_id = new Date().getTime();
                        let cond = {tmdb_id: obj.tmdb_id};
                        let upd = await insert(db.models.movie, obj, cond);
                        if (upd.hasOwnProperty('item') && obj.type) {
                            let obj = {sub: upd.item.movie_id, type: 1};
                            let check = await Sub.findAll();
                            await Sub.create(obj);
                            if (check.length < 1) await this.loadSubs();
                        }
                    }
                }
            }
        }

        for (let item of shows) {
            let entry = await db.models.show.findOne({where: {gid: item.id}});
            if (entry === null) {
                let results = (await this.searchTMDB('0', item.name)).results;
                if (results.length) {
                    let obj = await this.sift(0, results[0].id);
                    if (obj !== false) {
                        obj.gid = item.id;
                        let cond = {tmdb_id: obj.tmdb_id};
                        let check = await db.models.show.findOne({where: cond})
                        if (check === null)
                            await insert(db.models.show, obj, cond);
                    }
                }
            }
        }
    }

    /**
     * @desc an auto download function that downloads missing media based on the media already on server
     * @returns {Promise<void>}
     */
    async autoDownload() {
        let movies = await db.models.movie.findAll({raw: true, attributes: ['type', 'tmdb_id']});
        let shows = await db.models.show.findAll({raw: true, attributes: ['type', 'tmdb_id']});
        let data = movies.concat(shows);

        for (let item of data) {
            let info = (await pageTwo(item.type, item.tmdb_id, data, 0, 2, true)).map(item => {
                    return {
                        name: item.title === undefined ? item.name : item.title,
                        tmdb_id: item.id, type: !!item.title,
                        info_id: (!!item.title ? 'm': 's') + item.id
                    }
                }
            );

            for (let entry of info){
                let response = await this.getTMdbMagnet(entry.info_id);
                if (response.hasOwnProperty('url'))
                    await this.downloadTorrent(response.url)
            }
        }
    }

    /**
     * @desc checks if user has activated subtitles
     * @returns {boolean}
     */
    checkSub() {
        return !(OpenSubtitles === null);
    }
}

module.exports = Update;

