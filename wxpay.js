const WXPay = require('weixin-pay');
const fs = require('fs');

// if (!process.env.WEIXIN_APPID) throw new Error('environment variable WEIXIN_APPID missing');
// if (!process.env.WEIXIN_MCHID) throw new Error('environment variable WEIXIN_MCHID missing');
// if (!process.env.WEIXIN_PAY_SECRET) throw new Error('environment variable WEIXIN_PAY_SECRET missing');
// if (!process.env.WEIXIN_NOTIFY_URL) throw new Error('environment variable WEIXIN_NOTIFY_URL missing');

const wxpay = WXPay({
	appid: process.env.WEIXIN_APPID,
	mch_id: process.env.WEIXIN_MCHID,
	partner_key: process.env.WEIXIN_PAY_SECRET, //微信商户平台 API secret，非小程序 secret
	pfx: fs.readFileSync('./public/dist/certificate/apiclient_cert_space.p12'), //微信商户平台证书，暂不需要，退款需要-现在是space的证书
});

module.exports = wxpay;