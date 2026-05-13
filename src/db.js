const mongoose = require('mongoose');

async function connectDb(uri) {
  mongoose.set('strictQuery', true);
  await mongoose.connect(uri);
  return mongoose.connection;
}

module.exports = { connectDb };
