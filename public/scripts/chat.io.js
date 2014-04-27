(function($){

    // create global app parameters...
    var NICK_MAX_LENGTH = 15,
        ROOM_MAX_LENGTH = 10,
        lockShakeAnimation = false,
        mqttClient = null,
        nickname = null,

    // holds the current room we are in
        currentRoom = null,

    // server information
        serverAddress = 'localhost',
        serverDisplayName = 'MQTT Chat Server',
        serverDisplayColor = '#1c5380',

        keywordRoomNames = ['addroom, removeroom', 'totalrooms', 'totalclients', 'online', 'offline'],

    // some templates we going to use in the chat,
    // like message row, client and room, this
    // templates will be rendered with jQuery.tmpl
        tmplt = {
            room: [
                '<li data-roomId="${room}">',
                '<span class="icon"></span> ${room}',
                '</li>'
            ].join(""),
            client: [
                '<li data-clientId="${clientId}" class="cf">',
                '<div class="fl clientName"><span class="icon"></span> ${nickname}</div>',
                '<div class="fr composing"></div>',
                '</li>'
            ].join(""),
            message: [
                '<li class="cf">',
                '<div class="fl sender">${sender}: </div><div class="fl text">${text}</div><div class="fr time">${time}</div>',
                '</li>'
            ].join("")
        };

    // bind DOM elements like button clicks and keydown
    function bindDOMEvents(){

        $('.chat-input input').on('keydown', function(e){
            var key = e.which || e.keyCode;
            if(key == 13) { handleMessage(); }
        });

        $('.chat-submit button').on('click', function(){
            handleMessage();
        });

        $('#nickname-popup .input input').on('keydown', function(e){
            var key = e.which || e.keyCode;
            if(key == 13) { handleNickname(); }
        });

        $('#nickname-popup .begin').on('click', function(){
            handleNickname();
        });

        $('#addroom-popup .input input').on('keydown', function(e){
            var key = e.which || e.keyCode;
            if(key == 13) { createRoom(); }
        });

        $('#addroom-popup .create').on('click', function(){
            createRoom();
        });

        $('.big-button-green.start').on('click', function(){
            $('#nickname-popup .input input').val('');
            Avgrund.show('#nickname-popup');
            window.setTimeout(function(){
                $('#nickname-popup .input input').focus();
            },100);
        });

        $('.chat-rooms .title-button').on('click', function(){
            $('#addroom-popup .input input').val('');
            Avgrund.show('#addroom-popup');
            window.setTimeout(function(){
                $('#addroom-popup .input input').focus();
            },100);
        });

        $('.chat-rooms ul').on('scroll', function(){
            $('.chat-rooms ul li.selected').css('top', $(this).scrollTop());
        });

        $('.chat-messages').on('scroll', function(){
            var self = this;
            window.setTimeout(function(){
                if($(self).scrollTop() + $(self).height() < $(self).find('ul').height()){
                    $(self).addClass('scroll');
                } else {
                    $(self).removeClass('scroll');
                }
            }, 50);
        });

        $('.chat-rooms ul li').live('click', function(){
            var room = $(this).attr('data-roomId');
            if(room != currentRoom){
                mqttClient.unsubscribe(currentRoom);
                mqttClient.subscribe(room);
                // switch to room
                switchRoom(room);
            }
        });
    }

    function addRoom(name, announce){

        // check if the room is not already in the list
        if($('.chat-rooms ul li[data-roomId="' + name + '"]').length == 0){
            $.tmpl(tmplt.room, { room: name }).appendTo('.chat-rooms ul');
            // if announce is true, show a message about this room
            if(announce){
                insertMessage(serverDisplayName, 'The room `' + name + '` created...', true, false, true);
            }
        }
    }

    // remove a room from the rooms list
    function removeRoom(name, announce){
        $('.chat-rooms ul li[data-roomId="' + name + '"]').remove();
        // if announce is true, show a message about this room
        if(announce){

            insertMessage(serverDisplayName, 'The room `' + name + '` destroyed...', true, false, true);
        }
    }

    // add a client to the clients list
    function addClient(client, announce, isMe){
        var $html = $.tmpl(tmplt.client, client);

        // if this is our client, mark him with color
        if(isMe){
            $html.addClass('me');
        }

        // check if the room is not already in the list
        if($('.chat-clients ul li[data-clientid="' + client.clientId + '"]').length == 0){
            $html.appendTo('.chat-clients ul')
        }
    }

    // remove a client from the clients list
    function removeClient(client, announce){
        $('.chat-clients ul li[data-clientId="' + client + '"]').remove();

    }

    function createRoom(){
        var room = $('#addroom-popup .input input').val().trim();
        if(room && room.length <= ROOM_MAX_LENGTH && room != currentRoom
            && keywordRoomNames.indexOf(room) == -1){

            // show room creating message
            $('.chat-shadow').show().find('.content').html('Creating room: ' + room + '...');
            $('.chat-shadow').animate({ 'opacity': 1 }, 200);

            // unsubscribe from the current room
            mqttClient.unsubscribe(currentRoom);
            // create and subscribe to the new room
            mqttClient.subscribe(room);
            Avgrund.hide();
            initRoom(room);
            var msg = new Messaging.Message(JSON.stringify({room:room, nickname:nickname}));
            msg.destinationName = 'addroom';
            mqttClient.send(msg);
        } else {
            shake('#addroom-popup', '#addroom-popup .input input', 'tada', 'yellow');
            $('#addroom-popup .input input').val('');
        }
    }

    function setCurrentRoom(room){
        currentRoom = room;
        $('.chat-rooms ul li.selected').removeClass('selected');
        $('.chat-rooms ul li[data-roomId="' + room + '"]').addClass('selected');
    }

    function handleNickname(){
        var nick = $('#nickname-popup .input input').val().trim();
        if(nick && nick.length <= NICK_MAX_LENGTH){
            nickname = nick;
            Avgrund.hide();
            connect();
        } else {
            shake('#nickname-popup', '#nickname-popup .input input', 'tada', 'yellow');
            $('#nickname-popup .input input').val('');
        }
    }

    // handle the client messages
    function handleMessage(){
        var message = $('.chat-input input').val().trim();
        if(message){
            // send the message to the server with the room name
            var msg = new Messaging.Message(JSON.stringify({nickname: nickname, message: message}));
            msg.destinationName = currentRoom;
            mqttClient.send(msg);
            $('.chat-input input').val('');
        } else {
            shake('.chat', '.chat input', 'wobble', 'yellow');
        }
    }

    // insert a message to the chat window, this function can be
    // called with some flags
    function insertMessage(sender, message, showTime, isMe, isServer){
        var $html = $.tmpl(tmplt.message, {
            sender: sender,
            text: message,
            time: showTime ? getTime() : ''
        });

        // if isMe is true, mark this message so we can
        // know that this is our message in the chat window
        if(isMe){
            $html.addClass('marker');
        }

        // if isServer is true, mark this message as a server
        // message
        if(isServer){
            $html.find('.sender').css('color', serverDisplayColor);
        }
        $html.appendTo('.chat-messages ul');
        $('.chat-messages').animate({ scrollTop: $('.chat-messages ul').height() }, 100);
    }

    // return a short time format for the messages
    function getTime(){
        var date = new Date();
        return (date.getHours() < 10 ? '0' + date.getHours().toString() : date.getHours()) + ':' +
            (date.getMinutes() < 10 ? '0' + date.getMinutes().toString() : date.getMinutes());
    }

    // just for animation
    function shake(container, input, effect, bgColor){
        if(!lockShakeAnimation){
            lockShakeAnimation = true;
            $(container).addClass(effect);
            $(input).addClass(bgColor);
            window.setTimeout(function(){
                $(container).removeClass(effect);
                $(input).removeClass(bgColor);
                $(input).focus();
                lockShakeAnimation = false;
            }, 1500);
        }
    }

    function connect(){
        // show connecting message
        $('.chat-shadow .content').html('Connecting...');

        // creating the connection and saving the socket
        mqttClient = new Messaging.Client(serverAddress, 1884,nickname);
        mqttClient.connect({onSuccess:onConnect});
        mqttClient.onMessageArrived = onMessageArrived;


    }

    function onConnect() {
        // hiding the 'connecting...' message
        $('.chat-shadow').animate({ 'opacity': 0 }, 200, function(){
            $(this).hide();
            $('.chat input').focus();
        });
        currentRoom = 'Lobby';
        mqttClient.subscribe(currentRoom);
        mqttClient.subscribe('addroom');
        mqttClient.subscribe('removeroom');
        mqttClient.subscribe('totalrooms');
        mqttClient.subscribe('totalclients');
        mqttClient.subscribe('online');
        mqttClient.subscribe('offline');
        initRoom(currentRoom);
    };

    function onMessageArrived(message) {

        var msg = JSON.parse(message.payloadString);
        var topic = message.destinationName
        if(topic == 'addroom') {
            if(msg.nickname != nickname) {
                insertMessage(serverDisplayName, 'The room `' + msg.room + '` created...', true, false, true);
            }
        } else if(topic == 'removeroom') {
            removeRoom(msg.room, false);
        } else if(topic == 'totalrooms') {
            for(var i = 0, len = msg.length; i < len; i++){
                if(msg[i]._id && msg[i]._id != ''){
                    addRoom(msg[i]._id, false);
                }
            }

        } else if(topic == 'online') {
            if(msg.nickname != nickname && msg.room == currentRoom) {
                // show a message about this client
                insertMessage(serverDisplayName, msg.nickname + ' has joined the room...', true, false, true);

            }
        } else if(topic == 'offline') {
            if(msg.nickname != nickname && msg.room == currentRoom) {
                // if announce is true, show a message about this room
                insertMessage(serverDisplayName, msg.nickname + ' has left the room...', true, false, true);
                removeClient(msg.nickname, false);
            }
        }else if(topic == 'totalclients') {
            if(msg._id == currentRoom) {

                for(var i = 0, len = msg.clientIds.length; i < len; i++){
                    if(msg.clientIds[i]&& msg.clientIds[i] != nickname){
                        removeClient(msg.clientIds[i], false);
                    }
                }

                for(var i = 0, len = msg.clientIds.length; i < len; i++){
                    if(msg.clientIds[i] && msg.clientIds[i] != nickname){
                        addClient({nickname: msg.clientIds[i], clientId: msg.clientIds[i]}, false);
                    }
                }
            }
        } else {
            // send the message to the server with the room name

            insertMessage(msg.nickname, msg.message,true,  msg.nickname == nickname, false);
        }

    }

    function initRoom(room) {
        // add the room name to the rooms list
        addRoom(room, false);

        // set the current room
        setCurrentRoom(room);


        // announce a welcome message
        insertMessage(serverDisplayName, 'Welcome to the room: `' + room + '`... enjoy!', true, false, true);
        $('.chat-clients ul').empty();

        // add the clients to the clients list
        addClient({ nickname: nickname, clientId: nickname }, false, true);

        // hide connecting to room message message
        $('.chat-shadow').animate({ 'opacity': 0 }, 200, function(){
            $(this).hide();
            $('.chat input').focus();
        });

    }

    function switchRoom(room) {
        // set the current room
        setCurrentRoom(room);


        // announce a welcome message
        insertMessage(serverDisplayName, 'Welcome to the room: `' + room + '`... enjoy!', true, false, true);
        $('.chat-clients ul').empty();

        // add the clients to the clients list
        addClient({ nickname: nickname, clientId: nickname }, false, true);

        // hide connecting to room message message
        $('.chat-shadow').animate({ 'opacity': 0 }, 200, function(){
            $(this).hide();
            $('.chat input').focus();
        });

    }

    // on document ready, bind the DOM elements to events
    $(function(){
        bindDOMEvents();
    });

})(jQuery);