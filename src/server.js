const express = require('express'); //for api
const http = require('http'); //
const socketIo = require('socket.io');
const mongoose = require("mongoose");
const cors = require('cors'); // allow front and back communication
const dotenv = require('dotenv'); //loads enviroment variable from file env 
const { error } = require('console');
const path = require('path');
//required libraries
//initialize express app and http server
dotenv.config();

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
    cors: {
        origin: "http://localhost:3000/",
        methods: ['GET', 'POST', 'PUT', 'DELETE'],
        Credential: true
    }
});
//middleware
app.use(cors({
    origin: process.env.FRONTEND_URL,
    credintials: true
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true })); //parses url encoded bodies 



//data base and cloud storage connection 
mongoose.connect(process.env.MONGODB_URL).then(() => console.log("conected to mongoDB")).catch(err => { console.error('MongoDB error:', err);
    process.exit(1); });
//routes
app.use('api/rooms', roomRoutes);