const AV = require('leanengine');
const async = require('async');
const _ = require('underscore');
const uuid = require('uuid/v4');
const User = require("./model/user");
const UserDeposit = require("./model/UserDeposit");
const Sport = require("./model/Sport");


const Appointment = require("./model/Appointment");
const Transaction = require("./model/Transaction");
const Order = require("./order");
const LockDevice = require("./util/LockDevice");
const Control = require("./util/LockControl");
const Wxpay = require("./util/Wxpay");
const TransactionUtils = require("./util/TransactionUtils");
const wxpay = require("./wxpay");
// const t_pay = require("./WechatPay");



/**
 * 添加场地预约
 */
AV.Cloud.define('add_appointment', function (req, res) {
    console.log("add_appointment...");
    let sport_id = req.params.sport_id;//场所ID
    let start_time = req.params.start_time;//开始日期时间
    let end_time = req.params.end_time;//结束日期时间
    let user_time = req.params.user_time;//时长
    let uid = req.params.uid;//用户id
    let currentUser = AV.Object.createWithoutData('_User', uid);

    console.log("sport_id:", sport_id);
    console.log("start_time:", start_time);
    console.log("end_time:", end_time);
    console.log("user_time:", user_time);

    async.waterfall([function (cb) {
        console.log("校验请求参数");
        if (sport_id && start_time && end_time && uid) {
            currentUser.fetch().then(user => cb(null, user)).catch(cb);
        } else {
            cb(new Error("参数异常..."));
        }
    }, function (user, cb) {
        let is_deposit = user.get("is_deposit");
        console.log("is_deposit:" + is_deposit);
        if (is_deposit) {
            console.log("预约时间冲突查询");
            let options = {
                sport_id: sport_id,
                start_date_time: new Date(start_time),//用户预约的时间
                end_date_time: new Date(end_time),//用户预约的时间
            };
            console.log("options:", options);

            Appointment.findConflict(options, cb);
        } else {
            cb(new Error("请交押金"));
        }
    }, function (depositList, cb) {
        console.log("尝试创建预约信息");
        if (depositList && depositList.length > 0) {
            console.log("SIZE:" + depositList.length);
            console.log(depositList);
            cb(new Error("已被预约"));
        } else {
            async.parallel([function (cb) {
                new Appointment({
                    sport: AV.Object.createWithoutData('Sport', sport_id),
                    user: currentUser,
                    start_time: new Date(start_time),
                    end_time: new Date(end_time),
                    state: 1
                }).create(cb);
            }, function (cb) {
                Sport.findById(sport_id, cb);
            }], cb);//并行，但是结果数组有顺序
        }
    }, function (result, cb) {
        console.log("生成支付交易单...");
        let appointment = result[0];//并行，但是结果数组有顺序，预约id
        let sport = result[1];//并行，但是结果数组有顺序，场所

        let deposit_amount = user_time * sport.get("price");
        console.log("price:", sport.get("price"));
        console.log("user_time:", user_time);
        console.log("deposit_amount:", deposit_amount);

        new Transaction({
            user: currentUser,
            sport: AV.Object.createWithoutData('Sport', sport_id),
            appointment: appointment,
            order_code: TransactionUtils.createTransactionOrder(),
            amount: deposit_amount,//交易金额
            // amount: 1,//测试金额
            info: "预约[" + sport.get("sport_name") + "]" + user_time + "小时费用",
            pay_status_index: 1,
            transaction_type_index: 2
        }).create(cb);
    }], function (error, result) {
        if (error) {
            console.log(error);
            res.success({code: 0, msg: error.toString()});
        } else {
            res.success({code: 1, data: result});
        }
    });

});


/**
 * 取消预约
 */
AV.Cloud.define('cancel_appointment', function (req, res) {
    console.log("cancel_appointment...");
    let id = req.params.id;
    let uid = req.params.uid;
    let currentUser = AV.Object.createWithoutData('_User', uid);
    console.log("id:" + id);
    console.log("uid:" + uid);

    async.waterfall([function (cb) {
        if (id && currentUser) {
            Appointment.findById({id}, cb);
        } else {
            cb(new Error("参数异常..."));
        }
    }, function (appointment, cb) {
        console.log("判断取消状态...");
        let state = appointment.get("state");
        console.log("state:" + state);
        if (state === 20) {
            Transaction.find({
                appointment: appointment,
                transaction_type_index: 2
            }, function (error, transactionList) {
                if (error) {
                    cb(error);
                } else if (transactionList.length == 1) {
                    cb(null, {appointment, transaction: transactionList[0]});
                } else {
                    console.log("交易订单异常");
                    console.log(transactionList);
                    cb(new Error("交易订单异常"));
                }
            });
        } else {
            cb(new Error("该状态不能取消"));
        }
    }, function (result, cb) {
        const appointment = result.appointment;
        const transaction = result.transaction;
        console.log("创建退款交易和更新预约状态");
        async.parallel([function (cb) {
            new Transaction({
                data_id: appointment.id,
                amount: -transaction.get("amount"),
                pay_status_index: 1,
                transaction_type_index: 7,
                appointment: appointment,
                order_code: TransactionUtils.createTransactionOrder(),
                info: "预约费用退款",
                user: currentUser,
            }).create(cb);
        }, function (cb) {
            new Appointment({id: appointment.id, state: 7}).update(cb);
        }], cb);
    }], function (error, result) {
        if (error) {
            console.log(error);
            res.success({code: 0, msg: error.toString()});
        } else {
            res.success({code: 1});
        }
    });
});

/**
 * 控制开门逻辑
 */
AV.Cloud.define('open_door', function (req, res) {
    console.log("open_door...");
    let scan_code = req.params.scan_code;
    let uid = req.params.uid;
    console.log("scan_code:" + scan_code);
    console.log("uid:" + uid);

    const scanData = {};

    async.waterfall([function (cb) {
        if (scan_code && uid) {
            let codeArray = scan_code.split("|");
            scanData.option_type = codeArray[0];
            scanData.lock_sn = codeArray[1];
            scanData.sport_id = codeArray[2];

            cb();
        } else {
            cb(new Error("参数异常..."));
        }
    }, function (cb) {
        User.userInfoById({id: uid}, cb);
    }, function (user, cb) {
        let user_type_index = user.get("user_type_index");
        let user_manage = user.get("manage_sport");
        console.log("user_type_index:" + user_type_index);
        switch (user_type_index) {
            case 1://中心管理员扫码，直接开门
                LockDevice.getInstance().openLock(scanData.lock_sn, cb);
                break;
            case 2://场地管理员扫码，只能打开管理场地门禁
                if (user_manage && user_manage.id === scanData.sport_id) {
                    LockDevice.getInstance().openLock(scanData.lock_sn, cb);
                } else if (user_manage && user_manage.id) {
                    cb(new Error("您不具备开门权限"));
                } else {
                    cb(new Error("系统数据异常"));
                }
                break;
            case 3://普通用户扫码，需要有支付和预约相关逻辑
                new Control().userOpen(user, scanData, cb);
                break;
            default:
                cb(new Error("用户类型异常"));
                break;
        }
    }], function (error, result) {
        if (error) {
            console.log(error);
            res.success({code: 0, msg: error.toString()});
        } else {
            res.success(result);
        }
    });
});

   
/**
 * 创建预处理支付订单
 */
AV.Cloud.define('create_transaction_order', function (req, res) {
    console.log("create_transaction_order...");

    const user = req.currentUser;
    let order_code = req.params.order_code;
    let money = req.params.money;
    let transcation_id = req.params.transcation_id;
    let remote_ip = req.meta.remoteAddress;

    console.log("order_code:" + order_code);
    console.log("money:" + money);
    console.log("transcation_id:" + transcation_id);
    console.log("remote_ip:" + remote_ip);


    async.waterfall([function (cb) {
        console.log("获取交易详情...");
        Transaction.findById(transcation_id, cb);
    }, function (transaction, cb) {
        console.log("生成微信预处理订单---...");
        const orderData = {
            openid: user.get('authData').lc_weapp.openid,
            body: transaction.get("info"),
            out_trade_no: transaction.get("order_code"),
            total_fee: transaction.get("amount") + "",
            spbill_create_ip: remote_ip,
            notify_url: process.env.WEIXIN_NOTIFY_URL,
            trade_type: 'JSAPI',
        };
        console.log('orderData:==>', orderData);//这里打印了
        wxpay.createUnifiedOrder(orderData, cb);

        // wxpay.createUnifiedOrder(orderData,function(err, result) {
        //     console.log(err, result);
        //     if (err){
        //         console.log("err==>",err);
        //     } else{
        //         cb(null, result);
        //         console.log("results==>",result);
        //     }           
        //   });

        // let results1 = t_pay.getPayParams(orderData)
        // console.log("results1",results1)
        // cb(null, result);
        // console.log("cb===>",cb)
    }, function (results, cb) {
        console.log("检验请求状态值");//这里没有打印出来
        console.log("results:", results);
        if (results.return_code === 'FAIL') {
            cb(new Error(results.return_msg));
        } else if (results.result_code !== 'SUCCESS') {
            const error = new Error(results.err_code_des);
            error.code = results.err_code;
            cb(error);
        } else {
            cb(null, results);
        }
    }, function (results, cb) {
        console.log("检验请求签名值");
        const sign = wxpay.sign(results);
        if (sign === results.sign) {
            cb(null, results);
        } else {
            const error = new Error('微信返回参数签名结果不正确');
            error.code = 'INVALID_RESULT_SIGN';
            cb(error);
        }
    }, function (result, cb) {
        console.log("存储交易id");
        let prepay_id = result.prepay_id;
        console.log("prepay_id:" + prepay_id);
        new Transaction({
            id: transcation_id,
            prepay_id: prepay_id
        }).update(cb)
    }, function (transaction, cb) {
        let tradeId = transaction.get("order_code");
        let prepay_id = transaction.get("prepay_id");
        console.log('预订单创建成功：订单号 [' + tradeId + '] prepay_id [' + prepay_id + '}]');
        const payload = {
            appId: process.env.WEIXIN_APPID,
            timeStamp: String(Math.floor(Date.now() / 1000)),
            package: `prepay_id=` + prepay_id,
            signType: 'MD5',
            nonceStr: String(Math.random()),
        };
        payload.paySign = wxpay.sign(payload);
        cb(null, payload);
    }], function (error, result) {
        if (error) {
            console.log("error",error);
            res.success({code: 0, msg: error.toString()});
        } else {
            res.success({code: 1, data: result});
        }
    })
});


/**
 * 小程序创建订单
 * 微信支付订单
 */
AV.Cloud.define('order', (request, response) => {
    const user = request.currentUser;
    if (!user) {
        return response.error(new Error('用户未登录'));
    }
    const authData = user.get('authData');
    if (!authData || !authData.lc_weapp) {
        return response.error(new Error('当前用户不是小程序用户'));
    }
    const order = new Order();
    order.tradeId = uuid().replace(/-/g, '');
    order.status = 'INIT';
    order.user = request.currentUser;
    order.productDescription = 'LeanCloud-小程序支付测试';
    order.amount = 1;
    order.ip = request.meta.remoteAddress;
    if (!(order.ip && /^(?:[0-9]{1,3}\.){3}[0-9]{1,3}$/.test(order.ip))) {
        order.ip = '127.0.0.1';
    }
    order.tradeType = 'JSAPI';
    const acl = new AV.ACL();
    // 只有创建订单的用户可以读，没有人可以写
    acl.setPublicReadAccess(false);
    acl.setPublicWriteAccess(false);
    acl.setReadAccess(user, true);
    acl.setWriteAccess(user, false);
    order.setACL(acl);
    order.place().then(() => {
        console.log(`预订单创建成功：订单号 [${order.tradeId}] prepayId [${order.prepayId}]`);
        const payload = {
            appId: process.env.WEIXIN_APPID,
            timeStamp: String(Math.floor(Date.now() / 1000)),
            package: `prepay_id=${order.prepayId}`,
            signType: 'MD5',
            nonceStr: String(Math.random()),
        };
        payload.paySign = wxpay.sign(payload);
        response.success(payload);
    }).catch(error => {
        console.error(error);
        response.error(error);
    });
});


/**
 * 创建押金支付交易记录
 */
AV.Cloud.define('create_deposit_transaction', function (req, res) {
    console.log("create_deposit_transaction...");

    const user = req.currentUser;
    if (!user) {
        return response.error(new Error('用户未登录'));
    }

    async.waterfall([function (cb) {
        console.log("获取用户交易订单和用户押金值");
        // async.parallel([function (cb) {
        //     Transaction.find({
        //         pay_status_index: 1,
        //         transaction_type_index: 2,
        //         user: user
        //     }, cb);
        // }, function (cb) {
        //     UserDeposit.userUserDeposit(cb);
        // }], cb);

        UserDeposit.userUserDeposit(cb);
    }, function (userDeposit, cb) {
        console.log("创建或更新交易订单值");
        // let transactionList = result[0];
        // let userDeposit = result[1];
        let deposit_amount = userDeposit.get("amount");

        // if (transactionList.length > 0) {
        //     let transaction = transactionList[0];
        //     new Transaction({
        //         id: transaction.id,
        //         amount: deposit_amount
        //     }).update(cb);
        // } else {
        console.log("创建支付订单...");
        new Transaction({
            user: user,
            order_code: TransactionUtils.createTransactionOrder(),
            amount: deposit_amount,
            info: "支付押金",
            pay_status_index: 1,
            transaction_type_index: 1
        }).create(cb);
        // }
    }, function (transaction, cb) {
        console.log("更新交易用户押金");
        new User({
            id: user.id,
            amount: transaction.get("amount")
        }).update(function (error, user) {
            if (error) {
                cb(error);
            } else {
                cb(null, transaction);
            }
        })
    }], function (error, result) {
        if (error) {
            console.error(error);
            res.success({code: 0, msg: error.message});
        } else {
            res.success({code: 1, data: result});
        }
    });
});


/**
 * 押金退款申请
 */
AV.Cloud.define('cancel_deposit_transaction', function (req, res) {
    console.log("cancel_deposit_transaction...");

    const user = req.currentUser;
    if (!user) {
        return response.error(new Error('用户未登录'));
    }

    async.waterfall([function (cb) {
        console.log("查看用户是否存在正在申请的退款");
        Transaction.find({data_id: user.id, transaction_type_index: 4}, function (error, transaction_list) {
            if (error) {
                cb(error);
            } else if (transaction_list && transaction_list.length > 0) {
                cb(new Error("退款申请正在处理"));
            } else {
                user.fetch().then(user => cb(null, user)).catch(error => cb(error));
            }
        });
    }, function (user, cb) {
        let deposit_amount = user.get("deposit_amount");
        console.log("deposit_amount:" + deposit_amount);
        new Transaction({
            data_id: user.id,
            order_code: TransactionUtils.createTransactionOrder(),
            user:user,//luo-0929，完善用户字段
            amount: -deposit_amount,
            info: "押金退款申请",
            pay_status_index: 1,
            transaction_type_index: 4
        }).create(cb);
    }], function (error, result) {
        if (error) {
            console.error(error);
            res.success({code: 0, msg: error.message});
        } else {
            res.success({code: 1, data: result});
        }
    })


});

module.exports = AV.Cloud;
