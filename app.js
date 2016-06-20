
var express = require('express');
var app	= express();
var mosca = require('mosca');
var mqtt = require('mqtt');
var bodyParser = require('body-parser');
var bcrypt = require('bcrypt');
var server = require('http').createServer(app);
var mongoose = require('mongoose');
mongoose.Promise = global.Promise;
var port = 3000;
var wsAddress = 'ws://localhost:1884';
var Room = require('./models/room');
var Message = require('./models/message');
var topicKeywords = ['addroom', 'removeroom', 'totalrooms', 'totalclients', 'online', 'offline'];
server.listen(port);

//Mongoose Configurations
mongoose.connect('mongodb://localhost:27017/mqtt-chat');

app.use("/styles", express.static(__dirname + '/public/styles'));
app.use("/scripts", express.static(__dirname + '/public/scripts'));
app.use("/images", express.static(__dirname + '/public/images'));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({
    extended: true
}));

app.get('/', function (req, res) {
    res.sendFile(__dirname + '/public/index.html');
});

app.post('/setPassword', function(req, res){
    var room = req.body.room;
    var password = req.body.password;
    var hashPassword = bcrypt.hashSync(password, 10);
    Room.update({_id: room}, {$set: {password: hashPassword, protected: true}}, {upsert: true})
    .then(function(doc){
        res.sendStatus(200);
    })
    .catch(function(err){
        res.sendStatus(500);
    });
});

app.post('/checkPassword', function(req, res){
    var room = req.body.room;
    var password = req.body.password;
    Room.findOne({_id: room})
    .then(function(doc){
        if(bcrypt.compareSync(password, doc.password)){
            res.sendStatus(200);
        }else{
            res.sendStatus(401);
        }
    })
    .catch(function(err){
        res.sendStatus(401);
    });
});

//Mosca Settings
var options = {
    type: 'mongo',
    url:'mongodb://localhost:27017/mosca',
    pubsubCollection: 'messages',
    mongo: {}
};

var settings = {
    port: 1883,
    stats: false,
    logger: {
    },
    http: {
        port: 1884,
        static: __dirname + "/public",
        bundle: true
    },
    backend:options
};

var mqttServer = new mosca.Server(settings);
var mqttClient = mqtt.connect(wsAddress, {keepalive: 0});
process.on('SIGINT', function(){
    mqttClient.end();
    Room.remove({}, function(err){});
});

// fired when a message is received
mqttServer.on('published', function(packet, client) {
   if(topicKeywords.indexOf(packet.topic) === -1 && !packet.topic.includes('$SYS')){
        var messageJson = JSON.parse(packet.payload.toString('utf-8'));
        var message = new Message({from: messageJson.nickname, content:messageJson.message, room:packet.topic, date: new Date()});
        message.save();
    }
})

mqttServer.on('subscribed', function(topic, client) {
    if(topicKeywords.indexOf(topic) === -1){
        getMqttClient().publish('online', JSON.stringify({room:topic, nickname: client.id}));
        addRoomAndClient(topic, client);
    }
});

mqttServer.on('unsubscribed', function(topic, client) {
    if(topicKeywords.indexOf(topic) === -1) {
        getMqttClient().publish('offline', JSON.stringify({room:topic, nickname: client.id}));
        removeClientFromRoom(topic, client);
    }
});

//Chat Helper Functions
function addRoomAndClient(topic, client) {
    Room.update({_id: topic}, {$push: {clientIds:client.id}},{upsert:true})
    .then(function(data){
            notifyTotalRooms();
            notifyTotalClients(topic);
    });
}

function removeClientFromRoom(topic, client) {
    Room.update({_id: topic}, {$pull: {clientIds:client.id}},{upsert:true}).then(function(doc){
        Room.findOne({_id: topic}, '_id clientIds protected').then(function(doc){
            if(doc.clientIds.length > 0) {
                notifyTotalRooms();
                notifyTotalClients(topic);
            } else {
                Room.remove({ _id: topic }, function(err) {
                    if (!err) {
                        getMqttClient().publish('removeroom', JSON.stringify({room:topic}));
                    }
                });
            }
        })
    })
}

function notifyTotalRooms() {
    Room.find({}, '_id clientIds protected')
    .then(function(docs){
        getMqttClient().publish('totalrooms', JSON.stringify(docs));
    });
}

function notifyTotalClients(topic) {
    Room.findOne({_id: topic}, '_id clientIds protected')
    .then(function(doc){
        getMqttClient().publish('totalclients', JSON.stringify(doc));
    });
}

//Mosca Persistence
var onPersistenceReady = function() {
    persistence.wire(server);
}

var getMqttClient = function(){
    if(!mqttClient|| !mqttClient.connected){
        mqttClient = mqtt.connect(wsAddress, {keepalive: 0});
    }
    return mqttClient;
}

var persistence = mosca.persistence.Mongo(options, onPersistenceReady );