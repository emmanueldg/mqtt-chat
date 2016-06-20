var mongoose = require('mongoose');

var RoomSchema = new mongoose.Schema({
    _id: String,
    protected: Boolean,
    password: String,
    clientIds: [String]
});
var Room = mongoose.model('Room', RoomSchema);
module.exports = Room;