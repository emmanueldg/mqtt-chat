var mongoose = require('mongoose');

var MessageSchema = new mongoose.Schema({
    from: String,
    content: String,
    room: String,
    date: Date
});
var Message = mongoose.model('Message', MessageSchema);
module.exports = Message;