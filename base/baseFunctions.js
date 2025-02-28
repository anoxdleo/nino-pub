const fetch = require('node-fetch')
const axios = require('axios')

/**
 * @desc generates keys based on configuration (UUID FORMAT)
 * @returns {string}
 */
const create_UUID = () => {
    let dt = new Date().getTime();
    let uuid = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
        let r = (dt + Math.random() * 16) % 16 | 0;
        dt = Math.floor(dt / 16);
        return (c == 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    });
    return uuid;
}

/**
 * @desc takes an array and splits it in to 2 using the int as a guide
 * @param array
 * @param int
 * @returns {{result: *, left: *}}
 */
const takeFive = (array, int) => {
    int = int >= array.length ? array.length : int;
    let res = array.slice(0, int);
    array = array.slice(int, int + array.length)
    return {result: res, left: array};
}

/**
 * @desc generates keys based on configuration (key = x^n || x = a character n = length)
 * @param length
 * @returns {string}
 */
const makeId = length => {
    let result = '';
    let characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let charactersLength = characters.length;
    for (let i = 0; i < length; i++) {
        result += characters.charAt(Math.floor(Math.random() * charactersLength));
    }
    return result;
}

/**
 * @desc generates keys based on configuration (key = x^n-x^n... eg aw2W-iPo1-zQeP || segment = 4, length = 3)
 * @param length
 * @param segments
 * @returns {string}
 */
const generateKey = (length, segments) => {
    length = length || 4;
    segments = segments || 4;
    let int = 0;
    let response = '';

    while (int < length - 1) {
        response += makeId(segments) + '-';
        int++;
    }

    response += makeId(segments);
    return response;
}

/**
 * @desc fetch function wrapped in a promise
 * @param url
 * @param head assumed false until specified
 * @returns {Promise<*|[]|{}>} the header on fail or on demand otherwise returns a json file
 */
const sFetch = async (url, head) => {
    head = head || false;
    return await fetch(url)
        .then(response => {
            return head === true || response.status > 207 ? head === true ? response.headers : {headers: response.headers} : response.json();
        }).catch(reason => {
            console.log(reason);
            return false;
        });
}

async function pFetch(url, data) {
    return await fetch(url, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: data
    }).then(response => response.json())
        .then(data => {
            return data;
        })
        .catch(reason => console.log(reason));
}

const sAxios = async (url, head) => {
    head = head || false;
    return await axios.get(url)
        .then(response => {
            return head === true ? response.headers : response.data;
        }).catch(reason => {
            console.log(reason);
            return false;
        });
}

const aJax = async obj => {
    return new Promise((resolve, reject) => {
        axios(obj)
            .then(response => {
                resolve(response.data);
            }).catch(reason => {
            reject(reason);
        });
    })
}

/**
 * @desc helps searches the database for an array entries returned from TMDB, returning a smaller array of objects that do exist
 * @param array2 the host database
 * @param type to be accepted
 * @param keepKey useful for saving specific keys || optional
 * @returns {[]}
 */
Array.prototype.reduite = function (array2, type, keepKey) {
    keepKey = keepKey || false;
    let array = [];
    for (let i = 0; i < this.length; i += 1) {
        let res = array2.find(item => item.tmdb_id === this[i].id && item.type === type);
        if (res !== undefined) {
            if (keepKey)
                res[keepKey] = this[i][keepKey];
            array.push(res);
        }
    }

    return array;
}

/**
 * @desc returns all duplicates in ar array of objects using the property of the object needle
 * @param needle
 * @returns {*[]}
 */
Array.prototype.uniqueID = function (needle) {
    let a = this.concat();
    for (let i = 0; i < a.length; ++i) {
        for (let j = i + 1; j < a.length; ++j) {
            if (a[i][needle] === a[j][needle])
                a.splice(j--, 1);
        }
    }

    return a;
}

/**
 * @param length length of new array
 * @param id to be rejected
 * @param type to be rejected
 * @returns an int length array with random items from database: excluding the values listed
 */
Array.prototype.randomiseDB = function (length, id, type) {
    let array = [];
    let temp = this.filter(item => item.tmdb_id !== id && item.type !== type);
    length = length > temp.length ? temp.length : length;
    for (let i = 0; i < length; i++) {
        let int = Math.floor(Math.random() * temp.length);
        while (array.some(file => file.tmdb_id === temp[int].tmdb_id))
            int = Math.floor(Math.random() * temp.length);

        array.push(this[int]);
    }
    return array;
}

/**
 * @desc sorts an array of objects based on a property of the objects
 * @param key
 * @param asc
 * @returns {this}
 */
Array.prototype.sortKey = function (key, asc) {
    return this.sort(function (a, b) {
        let x = a[key];
        let y = b[key];
        return asc ? ((x < y) ? -1 : ((x > y) ? 1 : 0)) : ((x > y) ? -1 : ((x < y) ? 1 : 0));
    });
}

/**
 * @desc sorts an array based on 2 keys in the array and the 2 rules, 1 for each key
 * @param key1
 * @param key2
 * @param asc1
 * @param asc2
 * @returns {this}
 */
Array.prototype.sortKeys = function (key1, key2, asc1, asc2) {
    return this.sort(function (a, b) {
        let a1 = a[key1];
        let a2 = a[key2];
        let b1 = b[key1];
        let b2 = b[key2];

        if (a1 === b1)
            return asc2 ? ((a2 < b2) ? -1 : ((a2 > b2) ? 1 : 0)) : ((a2 > b2) ? -1 : ((a2 < b2) ? 1 : 0));

        else
            return asc1 ? ((a1 < b1) ? -1 : ((a1 > b1) ? 1 : 0)) : ((a1 > b1) ? -1 : ((a1 < b1) ? 1 : 0));
    });
}

/**
 * @desc takes a second array and adds it to the first array increasing the resulting rep in the process
 * @param array2
 * @param rep
 * @returns {[]}
 * @constructor
 */
Array.prototype.expand = function (array2, rep) {
    array2 = array2.map(item => {
        return {
            name: item.title === undefined ? item.name : item.title,
            id: item.id,
            tmdb_id: item.id,
            rep,
            poster: 'https://image.tmdb.org/t/p/original' + item.backdrop_path,
            type: item.title === undefined ? 0 : 1,
        };
    });
    let array = [];
    if (this.length) {
        for (let i = this.length - 1; i >= 0; i -= 1) {
            let res = array2.find(item => item.tmdb_id === this[i].tmdb_id && item.type === this[i].type);
            if (res !== undefined)
                this[i].rep = res.rep > this[i].rep ? res.rep + 1 : this[i].rep + 1;
            array.push(this[i]);
        }
    }

    return array.concat(array2).sortKey('rep', false).uniqueID('tmdb_id');
}

Array.prototype.missing = function (array2, key1, key2) {
    let array = []
    for (let i = 0; i < this.length; i++)
        if (!array2.some(item => item[key2] === this[i][key1]))
            array.push(this[i]);
    return array
}

Array.prototype.missingEntry = function (array2, val) {
    let array = []
    for (let i = 0; i < this.length; i++)
        if (!array2.some(item => item.tmdb_id === this[i].id && item.type === val))
            array.push({
                name: this[i].title === undefined ? this[i].name : this[i].title,
                tmdb_id: this[i].id, type: this[i].media_type === 'movie'
            });
    return array
}

/**
 * @desc helps compare the similarities between two strings
 * @param string
 * @param val
 * @returns {number|*}
 */
String.prototype.levenstein = function (string, val) {
    val = val || false;
    let a = this, b = string + "", m = [], i, j, min = Math.min;

    if (!(a && b)) return (b || a).length;

    for (i = 0; i <= b.length; m[i] = [i++]) ;
    for (j = 0; j <= a.length; m[0][j] = j++) ;

    for (i = 1; i <= b.length; i++) {
        for (j = 1; j <= a.length; j++) {
            m[i][j] = b.charAt(i - 1).toLowerCase() === a.charAt(j - 1).toLowerCase()
                ? m[i - 1][j - 1]
                : m[i][j] = min(
                    m[i - 1][j - 1] + 1,
                    min(m[i][j - 1] + 1, m[i - 1][j] + 1))
        }
    }

    return val ? m[b.length][a.length] < val: m[b.length][a.length];
}

String.prototype.strip = function (string) {
    let count = 0;
    let index = -1;
    let first = this.split(' ').filter(item => item !== '');
    let second = string.split(' ');
    let length = first.length > second.length ? first.length : second.length;

    for (let i = 0; i < first.length; i++)
        for (let j = index +1; j < second.length; j++) {
            if (first[i].replace(/[.,\/#!$%\^&\*;:{}=\-_`~()]/g, "").toLowerCase() === second[j].replace(/[.,\/#!$%\^&\*;:{}=\-_`~()]/g, "").toLowerCase()) {
                index = j;
                count++
                break;
            }
        }

    return (count/length) * 100 > 70;
}

/**
 * @desc converts an int to a valid bytes
 * @param bytes
 * @param decimals
 * @returns {string}
 */
const formatBytes = (bytes, decimals = 2) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

/**
 * @desc converts a String to a valid bytes value
 * @param string
 * @returns {int}
 */
const toBytes = string => {
    let index = -1;
    let k = 0;
    string = string.replace(/ /g, '')
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB'];
    for (let i = 0; i < sizes.length; i++)
        if (string.includes(sizes[i]))
            index = i;

    let bytes = Math.floor(parseFloat(string.replace(sizes[index], '')))
    while (k < index) {
        bytes *= 1024
        k++
    }

    return Math.floor(bytes)
}

let logger = true;

const change = value => {
    logger = value;
}

const getLogger = () => logger;

const log = (line, file, info) => {
    if (logger)
        console.log(line, file, info)
}

module.exports = {
    create_UUID,
    generateKey,
    log,
    sFetch,
    takeFive,
    change,
    sAxios,
    toBytes,
    formatBytes,
    getLogger,
    pFetch,
    aJax
};