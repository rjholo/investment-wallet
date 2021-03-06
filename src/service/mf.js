const axios = require('axios');
const data = require('./../data/mf.js');

module.exports = {
    getMFData: () => new Promise(async (resolve, reject) => {
        try {
            let promises = [];
            for (let i = 0; i < data.ids.length; i++) {
                mfid = data.ids[i];
                let res;
                try {
                    res = axios.get(`https://api.mfapi.in/mf/${mfid}`);
                    promises.push(res);
                } catch (error) {
                    console.error(error);
                }
            }
            const dataToResolve = (await Promise.all(promises)).map(res => res.data.meta);
            resolve(dataToResolve);
        } catch (e) {
            return reject(e);
        }
    }),

    getOrders: ({ Order, user }) => new Promise(async (resolve, reject) => {
        try {
            const orders = await Order.findAll({
                where: {
                    userId: user.id
                }
            });
            let promises = [];
            for (let i = 0; i < orders.length; i++) {
                const order = orders[i];
                try {
                    promises.push(axios.get(`https://api.mfapi.in/mf/${order.schemeCode}`));
                } catch (error) {
                    console.error(error);
                    continue;
                }
            }
            (await Promise.all(promises)).forEach((res, i) => {
                const nav = res.data.data[0].nav;
                const currentValue = Number((nav * orders[i].unit).toFixed(2));
                orders[i].dataValues.currentValue = currentValue;
            });
            resolve(orders);
        } catch (e) {
            return reject(e);
        }
    }),

    // getCurrentValueForOrders: ({ ordersStr }) => new Promise(async (resolve, reject) => {
    //     try {
    //         orders = JSON.parse(ordersStr);
    //         for (let i = 0; i < orders.length; i++) {
    //             const order = orders[i];
    //             let res;
    //             try {
    //                 res = await axios.get(`https://api.mfapi.in/mf/${order.schemeCode}`);
    //             } catch (error) {
    //                 console.error(error);
    //                 continue;
    //             }
    //             const nav = res.data.data[0].nav;
    //             const currentValue = Number((nav * order.unit).toFixed(2));
    //             order.dataValues.currentValue = currentValue;
    //         }
    //         resolve(orders);
    //     } catch (e) {
    //         return reject(e);
    //     }
    // }),

    buyFund: ({ body, Order, user, walletService, User, Transaction, sequelize }) => new Promise(async (resolve, reject) => {
        try {
            const amount = Number(Number(body.amount).toFixed(2));
            if (amount < 100) {
                return reject(`Minimum amount should be 100.`);
            }
            user = await User.findOne({
                where: {
                    id: user.id
                }
            });
            if (user.amount < amount) {
                return reject(`Insufficient Balance!`);
            }
            let res;
            try {
                res = await axios.get(`https://api.mfapi.in/mf/${body.schemeCode}`);
            } catch (error) {
                console.error(error);
                return reject(error);
            }
            const nav = res.data.data[0].nav;
            const unit = Number((amount / nav).toFixed(5));

            const orderId = Date.now();
            const order = {
                id: orderId,
                userId: user.id,
                schemeCode: body.schemeCode,
                unit,
                buyValue: amount,
                active: true
            };
            const transactionId = Date.now();
            const newTransaction = {
                id: transactionId,
                userId: user.id,
                amount,
                type: 'buy',
                fundOrderId: orderId
            };

            await sequelize.transaction(async (t) => {
                await user.update({
                    amount: user.amount - amount
                }, { transaction: t });
                await Transaction.create(newTransaction, { transaction: t });
                await Order.create(order, { transaction: t });
            });

            resolve({ orderId, transactionId, balance: user.amount });
        } catch (e) {
            return reject(e);
        }
    }),

    sellFund: ({ body, Order, user, walletService, User, Transaction, sequelize }) => new Promise(async (resolve, reject) => {
        try {
            const orderId = Number(body.fundOrderId);
            const order = await Order.findOne({
                where: {
                    id: orderId
                }
            });
            if (order.sellValue) {
                return reject(`Fund already sold!`);
            }

            let res;
            try {
                res = await axios.get(`https://api.mfapi.in/mf/${order.schemeCode}`);
            } catch (error) {
                console.error(error);
                return reject(error);
            }
            const nav = res.data.data[0].nav;
            const amount = Number((order.unit * nav).toFixed(2));

            const transactionId = Date.now();
            const transaction = {
                id: transactionId,
                userId: user.id,
                amount,
                type: 'sell',
                fundOrderId: orderId
            };
            user = await User.findOne({
                where: {
                    id: user.id
                }
            });

            await sequelize.transaction(async (t) => {
                await order.update({
                    sellValue: amount,
                    active: false
                }, { transaction: t });
                await Transaction.create(transaction, { transaction: t });
                await user.update({
                    amount: user.amount + amount
                }, { transaction: t });
            });

            resolve({ orderId, transactionId, balance: user.amount });
        } catch (e) {
            return reject(e);
        }
    })
};