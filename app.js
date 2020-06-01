'use strict';

let express = require('express');
let timeout = require('connect-timeout');
let path = require('path');
let bodyParser = require('body-parser');
let AV = require('leanengine');
let expressWs = require('express-ws');

//将moment设置为系统方法方便调用
global.moment = require("moment");

// 加载云函数定义，你可以将云函数拆分到多个文件方便管理，但需要在主文件中加载它们
require('./cloud');

let app = express();

// 启用 WebSocket 支持，如不需要可去除
expressWs(app);

// 设置模板引擎
app.set('views', path.join(__dirname, 'view'));
app.set('view engine', 'ejs');

// app.use('/static', express.static('public'));
app.use(express.static(path.join(__dirname, 'public')));

// 设置默认超时时间
app.use(timeout('15s'));

// 加载云引擎中间件
app.use(AV.express());

// 强制使用 https
app.enable('trust proxy');
app.use(AV.Cloud.HttpsRedirect());

// 加载 cookieSession 以支持 AV.User 的会话状态
app.use(AV.Cloud.CookieSession({secret: 'randomString', maxAge: 3600000, fetchUser: true}));

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({extended: false}));


app.use('/wechat', require('./routes/wechat'));
app.use('/oauth', require('./routes/oauth'));

//登录拦截器
app.use(function (req, res, next) {
    let url = req.originalUrl;
    // let currentUser = AV.User.current();
    let currentUser = req.currentUser;
    console.log("url:" + url);
    // console.log("currentUser:", currentUser);
    if (currentUser
        || "/vote/uploading" === url
        || "/weixin/pay-callback" === url
        || "/sport/app_near_sport" === url
        || "/sport/app_add_appointment" === url
        || url.indexOf("/sport/app_sport_info") > -1
        || url.indexOf("/user/login") > -1
    ) {
        next();
    } else {
        console.log('跳转到登录界面');
        res.redirect("/user/login");
    }
});

// 可以将一类的路由单独保存在一个文件中
app.get('/', require('./routes/index'));
app.use('/batch-update', require('./routes/batch-update'));
app.use('/captcha', require('./routes/captcha'));
app.use('/cloud-queue', require('./routes/cloud-queue'));
app.use('/crawler', require('./routes/crawler'));
app.use('/imagemagick', require('./routes/imagemagick'));
app.use('/long-running', require('./routes/long-running'));
app.use('/meta', require('./routes/meta'));

app.use('/user', require('./routes/user'));
app.use('/websocket', require('./routes/websocket'));
app.use('/order', require('./routes/order'));
app.use('/transaction', require('./routes/transaction'));
app.use('/sport', require('./routes/sport'));
app.use('/sport/edit_deposit', require('./routes/edit_deposit'));
app.use('/permissions', require('./routes/permissions'));
app.use('/appointment', require('./routes/appointment'));
// app.use('/appointment', require('./routes/appointment'));
app.use('/system', require('./routes/system'));
app.use('/weixin', require('./routes/weixin'));

app.use('/lean-cache', require('./lean-cache'));


app.use(function (req, res, next) {
    // 如果任何一个路由都没有返回响应，则抛出一个 404 异常给后续的异常处理器
    if (!res.headersSent) {
        let err = new Error('Not Found');
        err.status = 404;
        next(err);
    }
});

// error handlers
app.use(function (err, req, res, _next) {
    if (req.timedout && req.headers.upgrade === 'websocket') {
        // 忽略 websocket 的超时
        return;
    }

    let statusCode = err.status || 500;
    if (statusCode === 500) {
        console.error(err.stack || err);
    }
    if (req.timedout) {
        console.error('请求超时: url=%s, timeout=%d, 请确认方法执行耗时很长，或没有正确的 response 回调。', req.originalUrl, err.timeout);
    }
    res.status(statusCode);
    // 默认不输出异常详情
    let error = {};
    if (app.get('env') === 'development') {
        // 如果是开发环境，则将异常堆栈输出到页面，方便开发调试
        error = err;
    }
    res.render('error', {
        message: err.message,
        error: error
    });
});

module.exports = app;
