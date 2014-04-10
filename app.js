
var express 	= require('express'),
    app			= express(),
    mosca       = require('mosca'),
    mqtt        = require('mows'),
    server  	= require('http').createServer(app),
    mongoose    = require('mongoose'),
    port    	= 3000,
    wsAddress   = 'ws://localhost:1884',
    clients     = {};


server.listen(port);

//Mongoose Configurations
mongoose.connect('mongodb://localhost:27017/demo');
var RoomSchema = new mongoose.Schema(
    {_id: String,
        clientIds: [String]
    }
);
var Room = mongoose.model('Room', RoomSchema);


app.use("/styles", express.static(__dirname + '/public/styles'));
app.use("/scripts", express.static(__dirname + '/public/scripts'));
app.use("/images", express.static(__dirname + '/public/images'));


app.get('/', function (req, res) {
    res.sendfile(__dirname + '/public/index.html');
});

//Mosca Settings
var options = {
    type: 'mongo',
    url:'mongodb://localhost:27017/demoMosca',
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

mqttServer.on('subscribed', function(topic, client) {
    if(topic != 'addroom' && topic != 'removeroom' && topic != 'totalrooms'
        && topic != 'totalclients' && topic != 'online' && topic != 'offline') {
        var mqttClient = mqtt.createClient(wsAddress);
        mqttClient.publish('online', JSON.stringify({room:topic, nickname: client.id}));
        setTimeout(function() {
            mqttClient.end();
        }, 5000);
        addRoomAndClient(topic, client);
    }

});

mqttServer.on('unsubscribed', function(topic, client) {
    if(topic != 'addroom' && topic != 'removeroom' && topic != 'totalrooms' && topic != 'totalclients'
        && topic != 'online' && topic != 'offline') {
        var mqttClient = mqtt.createClient(wsAddress);
        mqttClient.publish('offline', JSON.stringify({room:topic, nickname: client.id}));
        setTimeout(function() {
            mqttClient.end();
        }, 5000);
        removeClientFromRoom(topic, client);
    }

});


//Chat Helper Functions
function addRoomAndClient(topic, client) {
    var room = new Room({_id: topic});

    room.save(function(err,data) {

        Room.update({_id: topic}, {$push: {clientIds:client.id}},{upsert:true},function(err){
            if(err) {

            } else  {
                notifyTotalRooms();
                notifyTotalClients(topic);
            }

        });
    });


}

function removeClientFromRoom(topic, client) {
	
    Room.update({_id: topic}, {$pull: {clientIds:client.id}},{upsert:true},function(err){
        if(!err)  {
            Room.findOne({_id: topic}, function(err, doc) {
                if(err) return null;

                if(doc.clientIds.length > 0) {
                    notifyTotalRooms();
                    notifyTotalClients(topic);
                } else {
                    Room.remove({ _id: topic }, function(err) {
                        if (!err) {
                            var mqttClient = mqtt.createClient(wsAddress);
                            mqttClient.publish('removeroom', JSON.stringify({room:topic}));
                            setTimeout(function() {
                                mqttClient.end();
                            }, 5000);
                        }
                    });
                }
            });

        }

    });


}

function notifyTotalRooms() {
    Room.find({}, function(err, docs) {
        if(err) return null
        var mqttClient = mqtt.createClient(wsAddress);
        mqttClient.publish('totalrooms', JSON.stringify(docs));

        setTimeout(function() {
            mqttClient.end();
        }, 5000);
    });
}

function notifyTotalClients(topic) {
    Room.findOne({_id: topic}, function(err, doc) {
        if(err) return null

        var mqttClient = mqtt.createClient(wsAddress);
        mqttClient.publish('totalclients', JSON.stringify(doc));

        setTimeout(function() {
            mqttClient.end();
        }, 5000);

    });
}

function disconnect(client){
    // get a list of rooms for the client
    Room.find({clientIds : client.id}, function(err, docs) {
        // unsubscribe from the rooms
        for(var room in docs.room){
            if(room){
                unsubscribe(client, { room: room});
            }
        }

        delete clients[client.id];
    });
}

function unsubscribe(client, topic){
    // update all other clients about the offline
    // presence
    updatePresence(topic, client, 'offline');

    client.unsubscribe(topic);

    if(!countClientsInRoom(topic)){

        mqttServer.publish('removeroom', JSON.stringify({ room: topic}));
    }
}

function getRooms(){

    Room.find({}, function(err, docs) {
        if(err) return null;

        return docs;
    });

}

function subscribe(client, topic){
    // get a list of all active rooms
    var rooms = getRooms();

}


function getClientsInRoom(clientId, topic){

    var clientIds = [];
    Room.find({room:topic}, function(err, docs) {
        
        for(var doc in docs) {
            clientIds.push(doc.room);
        }

        var clients = [];

        if(clientIds && clientIds.length > 0){
            socketsCount = clientIds.lenght;

            
            for(var i = 0, len = clientIds.length; i < len; i++){

                if(clientIds[i] != clientIds){
                    clients.push(clients[clientIds[i]]);
                }
            }
        }

        return clients;
    });

}

function countClientsInRoom(room){

    Room.findOne({room:topic}, function(err, doc) {
        if(doc) {
            return doc.length;
        }
        return 0;
    });
}

function updatePresence(topic, client, state){

    if(state == 'online') {
        Room.update({room: 'topic'},{$push: {clientIds:client.id}},{upsert:true},function(err){
            if(err) {

            } else  {
                client.publish(topic, JSON.stringify({ client: clients[client.id], state: state, room: topic, presence: true }));
            }

        });
    } else {
        Room.update({room: 'topic'},{$pull: {clientIds:client.id}},{upsert:true},function(err){
            if(err) {

            } else  {
                client.publish(topic, JSON.stringify({ client: clients[client.id], state: state, room: topic, presence: true }));
            }

        });
    }
}

//Mosca Persistence

var onPersistenceReady = function()
{
    persistence.wire(server);
}

var persistence = mosca.persistence.Mongo(options, onPersistenceReady );



