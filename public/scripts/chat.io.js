(function($){

    // create global app parameters...
    var NICK_MAX_LENGTH = 15,
        ROOM_MAX_LENGTH = 10,
        lockShakeAnimation = false,
        mqttClient = null,
        nickname = null,

        currentRoom = null,
        isRoomProtected = false,

    // server information
        serverAddress = 'localhost',
        serverDisplayName = 'MQTT Chat Server',
        serverDisplayColor = '#1c5380',
        keywordRoomNames = ['addroom', 'removeroom', 'totalrooms', 'totalclients', 'online', 'offline'],

        tmplt = {
            room: [
                '<li data-roomId="${room}">',
                '<span class="icon"></span> ${room} <div style="${lockCss}"><img src="images/lock.png"/></div>',
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
            ].join(""),
            image: [
                '<li class="cf">',
                '<div class="fl sender">${sender}: </div><div class="fl image"><canvas style="margin-left: 100px" class="img_uploaded"></canvas></div><div class="fr time">${time}</div>',
                '</li>'
            ].join("")
        };

    function bindDOMEvents(){
        $('.chat-input input').on('keydown', function(e){
            var key = e.which || e.keyCode;
            if(key == 13) { handleMessage(); }
        });

        $('.chat-upload input').on('change', function(){
            var uploadedFiles = this.files;
            handlePictureUpload(uploadedFiles, function() {
                this.files = undefined;
            });
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

        $('#password-popup .input input').on('keydown', function(e){
            var key = e.which || e.keyCode;
            if(key == 13) { handlePassword(); }
        });

        $('#password-popup .join').on('click', function(){
            handlePassword();
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
            var protected = $($(this).children('div')[0]).css('display') === 'inline';
            if(room != currentRoom){
                if(protected){
                    $('#password-popup .input input').val('');
                    $('#password-popup .room-name').val(room);
                    var popupTitle = 'Enter password for ' + room;
                    $('#password-popup .popup-title').text(popupTitle);
                    Avgrund.show('#password-popup');
                    window.setTimeout(function(){
                        $('#password-popup .input input').focus();
                    },100);
                } else{
                    mqttClient.unsubscribe(currentRoom);
                    mqttClient.subscribe(room);
                    switchRoom(room);
                }
            }
        });
    }

    function addRoom(name, announce, protected){
        var lockCss = 'display: ' + (protected? 'inline' : 'none');
        if($('.chat-rooms ul li[data-roomId="' + name + '"]').length == 0){
            $.tmpl(tmplt.room, { room: name, lockCss: lockCss}).appendTo('.chat-rooms ul');
            // if announce is true, show a message about this room
            if(announce){
                insertMessage(serverDisplayName, 'The room `' + name + '` created...', true, false, true);
            }
        }
    }

    function removeRoom(name, announce){
        $('.chat-rooms ul li[data-roomId="' + name + '"]').remove();
        // if announce is true, show a message about this room
        if(announce){
            insertMessage(serverDisplayName, 'The room `' + name + '` destroyed...', true, false, true);
        }
    }

    function addClient(client, announce, isMe){
        var $html = $.tmpl(tmplt.client, client);
        if(isMe){
            $html.addClass('me');
        }
        if($('.chat-clients ul li[data-clientid="' + client.clientId + '"]').length == 0){
            $html.appendTo('.chat-clients ul');
        }
    }

    function removeClient(client){
        $('.chat-clients ul li[data-clientId="' + client + '"]').remove();
    }

    function createRoom(){
        var room = $('#addroom-popup .input input').val().trim();
        var protected = $('#passwordProtection').prop('checked');
        if(protected && !$('#password').val()){
            shake('#addroom-popup', '#addroom-popup .input input', 'tada', 'yellow');
        } else if(room && room.length <= ROOM_MAX_LENGTH && room != currentRoom
            && keywordRoomNames.indexOf(room) == -1){
            if(protected){
                var password = protected ? $('#password').val() : undefined;
                $.post('/setPassword', {room: room, password: password})
                 .done(function(data){
                      completeRoomCreation(room, protected);
                 });
            } else{
                completeRoomCreation(room, protected);
            }

        } else {
            shake('#addroom-popup', '#addroom-popup .input input', 'tada', 'yellow');
            $('#addroom-popup .input input').val('');
        }
    }

    function completeRoomCreation(room, protected){
        // show room creating message
        $('.chat-shadow').show().find('.content').html('Creating room: ' + room + '...');
        $('.chat-shadow').animate({ 'opacity': 1 }, 200);

        // unsubscribe from the current room
        mqttClient.unsubscribe(currentRoom);
        // create and subscribe to the new room
        mqttClient.subscribe(room);
        Avgrund.hide();
        var msg = new Messaging.Message(JSON.stringify({room:room, nickname:nickname, protected: protected}));
        msg.destinationName = 'addroom';
        mqttClient.send(msg);
        initRoom(room, protected);
    }

    function setCurrentRoom(room, protected){
        currentRoom = room;
        isRoomProtected = protected;
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

    function handlePassword(){
        var room = $('#password-popup .room-name').val();
        var password = $('#password-popup .input input').val();
        if(password){
            $.post('/checkPassword', {room: room, password: password})
                .done(function(data){
                    Avgrund.hide();
                    mqttClient.unsubscribe(currentRoom);
                    mqttClient.subscribe(room);
                    switchRoom(room);
                })
                .fail(function(err){
                    shake('#password-popup', '#password-popup .input input', 'tada', 'yellow');
                    $('#password-popup .input input').val('');
                });
        } else {
            shake('#password-popup', '#password-popup .input input', 'tada', 'yellow');
            $('#password-popup .input input').val('');
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

    function handlePictureUpload(files, callback) {
            for(var i = 0; i < files.length; i++) {
                // send the message to the server with the room name
                var reader = new FileReader();
                reader.onloadend = function(evt) {
                    var msg = new Messaging.Message(JSON.stringify({nickname: nickname, message: evt.target.result, type: 'image'}));
                    msg.destinationName = currentRoom;
                    mqttClient.send(msg);
                };
                reader.readAsDataURL(files[i]);
            }
            callback();
    }
    // insert a message to the chat window, this function can be
    // called with some flags
    function insertMessage(sender, message, showTime, isMe, isServer){
        var $html = $.tmpl(tmplt.message, {
            sender: sender,
            text: message,
            time: showTime ? getTime() : ''
        });
        setMessageCss($html, isMe, isServer);
    }

    function insertImage(sender, message, showTime, isMe, isServer){
        var $html = $.tmpl(tmplt.image, {
            sender: sender,
            time: showTime ? getTime() : ''
        });
        var img = new Image();
        var canvas = $html.find('.img_uploaded')[0];
        var context = canvas.getContext('2d');
        img.src= message;
        img.onload = function() {
            context.drawImage(img,0,0,200,180);
        }
        setMessageCss($html, isMe, isServer);
    }

    function setMessageCss($html, isMe, isServer){
        if(isMe){
            $html.addClass('marker');
        }
        if(isServer){
            $html.find('.sender').css('color', serverDisplayColor);
        }
        $html.appendTo('.chat-messages ul');
        $('.chat-messages').animate({ scrollTop: $('.chat-messages ul').height() }, 100);
    }

    function getTime(){
        var date = new Date();
        return (date.getHours() < 10 ? '0' + date.getHours().toString() : date.getHours()) + ':' +
            (date.getMinutes() < 10 ? '0' + date.getMinutes().toString() : date.getMinutes());
    }

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
        $('.chat-shadow .content').html('Connecting...');
        mqttClient = new Messaging.Client(serverAddress, 1884, nickname);
        mqttClient.connect({onSuccess:onConnect, keepAliveInterval: 0});
        mqttClient.onMessageArrived = onMessageArrived;
    }

    function onConnect() {
        $('.chat-shadow').animate({ 'opacity': 0 }, 200, function(){
            $(this).hide();
            $('.chat input').focus();
        });
        currentRoom = 'Lobby';
        isRoomProtected = false;
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
        var topic = message.destinationName;
        if(topic == 'addroom') {
            if(msg.nickname != nickname) {
                insertMessage(serverDisplayName, 'The room `' + msg.room + '` created...', true, false, true);
            }
        } else if(topic == 'removeroom') {
            removeRoom(msg.room, false);
        } else if(topic == 'totalrooms') {
            for(var i = 0, len = msg.length; i < len; i++){
                if(msg[i]._id && msg[i]._id != ''){
                    var protected = msg[i].protected === undefined ? false : msg[i].protected;
                    addRoom(msg[i]._id, false, protected);
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
                removeClient(msg.nickname);
            }
        }else if(topic == 'totalclients') {
            if(msg._id == currentRoom) {
                for(var i = 0, len = msg.clientIds.length; i < len; i++){
                    if(msg.clientIds[i]&& msg.clientIds[i] != nickname){
                        addClient({nickname: msg.clientIds[i], clientId: msg.clientIds[i]}, false);
                    }
                }
            }
        } else {
            if(msg.type === 'image') {
                insertImage(msg.nickname, msg.message, true, msg.nickname == nickname, false);
            } else {
                insertMessage(msg.nickname, msg.message, true, msg.nickname == nickname, false);
            }
        }
    }

    function initRoom(room, protected) {
        addRoom(room, false, protected);
        setCurrentRoom(room, protected);
        insertMessage(serverDisplayName, 'Welcome to the room: `' + room + '`... enjoy!', true, false, true);
        $('.chat-clients ul').empty();
        addClient({ nickname: nickname, clientId: nickname }, false, true);
        $('.chat-shadow').animate({ 'opacity': 0 }, 200, function(){
            $(this).hide();
            $('.chat input').focus();
        });

    }

    function switchRoom(room) {
        setCurrentRoom(room);
        insertMessage(serverDisplayName, 'Welcome to the room: `' + room + '`... enjoy!', true, false, true);
        $('.chat-clients ul').empty();
        addClient({ nickname: nickname, clientId: nickname }, false, true);
        $('.chat-shadow').animate({ 'opacity': 0 }, 200, function(){
            $(this).hide();
            $('.chat input').focus();
        });

    }

    $(function(){
        bindDOMEvents();
    });

})(jQuery);