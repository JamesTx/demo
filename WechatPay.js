//用tenpay
const tenpay=require('tenpay')
const AV = require('leanengine');
const t_config = {
	appid: process.env.WEIXIN_APPID,
	mch_id: process.env.WEIXIN_MCHID,
	partner_key: process.env.WEIXIN_PAY_SECRET, //微信商户平台 API secret，非小程序 secret
    // pfx: fs.readFileSync('./public/dist/certificate/apiclient_cert_003.p12'), //微信商户平台证书，暂不需要
    notify_url:process.env.WEIXIN_NOTIFY_URL
}; 
const t_pay=new tenpay(t_config)
module.exports=t_pay