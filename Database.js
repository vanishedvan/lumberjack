/**
 * @license
 * Copyright (c) 2019 vanished
 * 
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 * 
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 * 
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */

"use strict";

const User = require("./game/User.js");
const Inventory = require("./game/Inventory.js");
const InventoryCorruptedError = require("./game/InventoryCorruptedError.js");
const {sGetItemDetails} = require("./game/item/Item.js");
const Axe = require("./game/item/axe/Axe.js");
const {Database} = require("./Constants.js");
const {getAllTypes} = require("./utility/ItemUtilities.js");
const {
    t,
    unwrap
} = require("./utility/Type.js");
const sqlite3 = require("sqlite3").verbose();
const sql = require("sql-bricks");
const PATH = "./jack.db";

const PLACEHOLDER_OPTION = {placeholder: "?"};
let dbPromise;
const ERROR_CANNOT_ACCESS_DATABASE = "Can't access database!";

function getDatabase() {

    if (!dbPromise) {
        dbPromise = new Promise(resolve => {

            let db = new sqlite3.Database(PATH, sqlite3.OPEN_READWRITE, error => {

                if (!error) {
                    return resolve(db.on("error", console.error));
                }

                db = new sqlite3.Database(PATH, error => {

                    if (error) {
                        return resolve(console.error(error));
                    }

                    db.run(`

CREATE TABLE ${Database.TABLE_NAME} (
    ${Database.ID}        ${Database.Queries.DataTypes.TEXT}    ${Database.Queries.Constraints.UNIQUE} ON CONFLICT REPLACE
                                                                ${Database.Queries.Constraints.NOT_NULL},
    ${Database.MONEY}     ${Database.Queries.DataTypes.INTEGER} ${Database.Queries.Constraints.DEFAULT} ${0},
    ${Database.INVENTORY} ${Database.Queries.DataTypes.TEXT}    ${Database.Queries.Constraints.NOT_NULL}
)
                    `.trim().replace(/(\s*\r*\n+\s*)|(\s+)/g, " "),

                        error => resolve(error ? console.error(error) : db.on("error", console.error)));
                });
            });
        });
    }
    return dbPromise;
}

function update(user) {

    if (!t(user, User)) {
        throw new TypeError("Incorrect type for update argument!");
    }

    if (process.env.DATABASE_CLOSED) {
        return Promise.reject(new Error("update is called but database is already closed."));
    }

    return new Promise((resolve, reject) => getDatabase().then(db => {

        if (!db) {
            return reject(new Error(ERROR_CANNOT_ACCESS_DATABASE));
        }

        const params = sql
            .insertInto(Database.TABLE_NAME, Database.ID, Database.MONEY, Database.INVENTORY)
            .values(user[Database.ID], user[Database.MONEY], JSON.stringify(user[Database.INVENTORY]))
            .toParams(PLACEHOLDER_OPTION);

        db.run(params.text, params.values, error => error ? reject(error) : resolve(user));
    }));
}

function retrieve(id, abortIfNon) {

    id = unwrap(id);
    abortIfNon = unwrap(abortIfNon);
    if (!((id == null || t(id, "string")) && (abortIfNon == null || t(abortIfNon, "boolean")))) {
        throw new TypeError("Incorrect type(s) for retrieve arguments!");
    }

    if (process.env.DATABASE_CLOSED) {
        return Promise.reject(new Error("retrieve is called but database is already closed."));
    }

    return new Promise((resolve, reject) => getDatabase().then(db => {

        if (!db) {
            return reject(new Error(ERROR_CANNOT_ACCESS_DATABASE));
        }

        const rowToUser = row => new User(row.id, row.money, row.inventory);
        const query = sql.select().from(Database.TABLE_NAME);

        if (id == null) {
            db.all(query.toParams().text, (error, rows) => error ? reject(error) :

                resolve(rows.map(row => {
                    try {
                        return rowToUser(row);
                    } catch (error) {
                        return error;
                    }
                })));

        } else {
            const params = query.where(Database.ID, id).toParams(PLACEHOLDER_OPTION);
            db.get(params.text, params.values, (error, row) => {

                if (error) {
                    return reject(error);
                }

                if (!row) {
                    if (abortIfNon) {
                        return resolve();
                    }
                    const user = new User(id);
                    return update(user).catch(console.error).finally(() => resolve(user));
                }

                try {
                    resolve(rowToUser(row));
                } catch (error) {
                    reject(error);
                }
            });
        }
    }));
}

function remove(id) {

    id = unwrap(id);
    if (!t(id, "string")) {
        throw new TypeError("Incorrect type for remove argument!");
    }

    if (process.env.DATABASE_CLOSED) {
        return Promise.reject(new Error("remove is called but database is already closed."));
    }

    console.log(`Attempting to delete row whose ID is ${id}`);
    return new Promise((resolve, reject) => getDatabase().then(db => {

        if (!db) {
            return reject(new Error(ERROR_CANNOT_ACCESS_DATABASE));
        }

        const params = sql.deleteFrom(Database.TABLE_NAME).where(Database.ID, id).toParams(PLACEHOLDER_OPTION);
        db.run(params.text, params.values, error => error ? reject(error) : resolve());
    }));
}

function closeDatabase() {

    if (process.env.DATABASE_CLOSED) {
        return Promise.reject(new Error("closeDatabase is called but it was already called previously."));
    }

    return new Promise((resolve, reject) => getDatabase().then(db => {

        if (!db) {
            return reject(new Error(ERROR_CANNOT_ACCESS_DATABASE));
        }

        db.close(error => {
            if (error) {
                return reject(error);
            }
            process.env.DATABASE_CLOSED = "true";
            resolve();
        });
    }));
}

function fixData(id) {

    id = unwrap(id);
    if (!(id == null || t(id, "string"))) {
        throw new TypeError("Incorrect type for fixData argument!");
    }

    if (process.env.DATABASE_CLOSED) {
        return Promise.reject(new Error("fixData is called but database is already closed."));
    }

    const testId = idToTest => /^\d+$/.test(idToTest);

    return new Promise((resolve, reject) => getDatabase().then(db => {

        if (!db) {
            return reject(new Error(ERROR_CANNOT_ACCESS_DATABASE));
        }

        retrieve(id, true).then(async users => {

            if (!users) {
                return reject(new Error(`User with ID ${id} is not in the database`));
            }

            const fixDataPromiseFunction = user => {

                const userId = user.id;
                if (!testId(userId)) {
                    return remove(userId);
                }

                const userInventory = user.inventory;
                Array.from(userInventory).filter(item => t(item, Axe) && (item.isBroken() || !item.isValid()))
                .forEach(item => {
                    console.log(`Attempting to delete a ${item.getItemDetails().friendlyName} as it's broken or invalid`);
                    userInventory.delete(item);
                });

                return update(user);
            };

            if (Array.isArray(users)) {
                const results = [];
                for (const user of users) {

                    if (t(user, InventoryCorruptedError)) {
                        results.push(await fixRawData(user.id).catch(error => error));
                    } else if (t(user, Error)) {
                        results.push(user);
                    } else {
                        results.push(await fixDataPromiseFunction(user).catch(error => error));
                    }
                }
                return resolve(results);
            }

            resolve(fixDataPromiseFunction(users));

        }, error => t(error, InventoryCorruptedError) ? resolve((testId(id) ? fixRawData : remove)(id)) : reject(error));
    }));
}

function fixRawData(id) {

    id = unwrap(id);
    if (!t(id, "string")) {
        throw new TypeError("Incorrect type for fixRawData argument!");
    }

    if (process.env.DATABASE_CLOSED) {
        return Promise.reject(new Error("fixRawData is called but database is already closed."));
    }

    return new Promise((resolve, reject) => getDatabase().then(db => {

        if (!db) {
            return reject(new Error(ERROR_CANNOT_ACCESS_DATABASE));
        }

        const selectParams = sql.select().from(Database.TABLE_NAME).where(Database.ID, id).toParams(PLACEHOLDER_OPTION);
        db.get(selectParams.text, selectParams.values, (error, row) => {

            if (error) {
                return reject(error);
            }

            let parsed;
            try {
                parsed = JSON.parse(row.inventory);
            } catch (error) {
                console.log(`Attempting to reset inventory for row whose ID is ${id}, as inventory data is not parsable`);
            }

            if (parsed) {
                if (!Array.isArray(parsed)) {
                    console.log(`Attempting to reset inventory for row whose ID is ${id}, as inventory JSON object is not an array`);
                    parsed = undefined;
                } else {

                    const allTypes = getAllTypes();
                    parsed = parsed.filter(item => {

                        if (!t(item, "object")) {
                            console.log("Attempting to delete an item as it's not an object");
                            return false;
                        }

                        const name = item.name;
                        if (!(t(name, "string") && name in allTypes)) {
                            console.log(`Attempting to delete an item of name ${name} as it's unrecognized`);
                            return false;
                        }

                        const Type = allTypes[name];
                        const durability = item.durability;

                        if (t(Type, Axe)) {
                            const details = sGetItemDetails(Type);

                            if (durability === undefined || !(Number.isInteger(durability) && durability > 0) ||
                                durability > Math.max(...Object.values(details.durability))) {
                                console.log(`Attempting to delete a ${details.friendlyName} as its durability ${durability} is invalid`);
                                return false;
                            }
                            return true;
                        }
                        return true;
                    });
                }
            }

            const insertParams = sql
                .insertInto(Database.TABLE_NAME, Database.ID, Database.INVENTORY)
                .values(id, JSON.stringify(parsed ? parsed : new Inventory(id)))
                .toParams(PLACEHOLDER_OPTION);

            db.run(insertParams.text, insertParams.values, error => error ? reject(error) : resolve());
        });
    }));
}

module.exports = {
    update,
    retrieve,
    remove,
    closeDatabase,
    fixData
};
