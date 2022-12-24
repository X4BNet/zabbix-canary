const {ZabbixClient} = require('zabbix-client'),
      NodeMailer = require('nodemailer'),
      Q = require('@halleyassist/q-lite')

const RecordThreshold = 60 * 30
const EmailAlertFrom = process.env.EMAIL_ALERT_FROM
const EmailAlertTo = process.env.EMAIL_ALERT_TO

let s = NodeMailer.createTransport({
    sendmail: true,
    newline: 'unix',
    path: '/usr/sbin/sendmail'
});

async function getLatest(api, historyType){
    const ret = await api.method("history.get").call(
        {
            'history': historyType,
            'sortfield': 'clock',
            'sortorder': 'DESC',
            'limit': 1,
            'time_from': Math.floor((Date.now() / 1000) - RecordThreshold)
        }
    );

    if(!ret.length) return -1;
    return ret[0].clock
}

async function sendAlert(reason) {
    const mail = {
        to: EmailAlertTo,
        subject: `Zabbix Canary failure (${reason})`,
        text: `Zabbix Canary failure (${reason})`
    }
    if(EmailAlertFrom) {
        mail.from = EmailAlertFrom
    }
    await s.sendMail(mail);
}

async function main(){
    console.log("Started")

    const client = new ZabbixClient(process.env.ZABBIX_URL+"/api_jsonrpc.php");
    
    let lastSuccessful = Date.now(), isProblem = false

    while(true) {
        // A token will be fetched and saved for further use
        const api = await client.login(process.env.ZABBIX_USER, process.env.ZABBIX_PASS);

        let runProblem = false
        try {
            const latestRecords = [
                await getLatest(api, 0),
                await getLatest(api, 3)
            ]

            let lastRecord = -1
            for(var r of latestRecords){
                if(r > lastRecord) lastRecord = r
                if(r == -1){
                    if(!isProblem) await sendAlert('no data')
                    runProblem = true
                }
            }
            if(lastRecord == -1) console.log("Last record not found")
            else console.log("Last record " + Math.floor((Date.now() - (lastRecord * 1000))/1000) + "s ago")
        } catch(ex) {
            console.log(ex)
            if(lastSuccessful < (Date.now() - (60 * 60 * 1000))){
                await sendAlert('exception')
                runProblem = true
            }
        } finally {
            await api.logout();
        }

        if(runProblem){
            if(!isProblem) {     
                isProblem = true       
            }
        } else {
            lastSuccessful = Date.now()
            if(isProblem){
                console.log("Recovered")
                isProblem = false
            }
        }

        // wait 1m
        await Q.delay(1000 * 60)
    }
}

main()