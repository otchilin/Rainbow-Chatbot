// Load Agent & Node SDK
const ChatBot = require("../index");
const NodeSDK = require("rainbow-node-sdk");

// Load bot identity
const bot = require("./bot.json");          // Load bot identity
const scenario = require("./sample_message.json");  // Load scenario

let nodeSDK = new NodeSDK(bot);

// Initialize agent
let chatbot = new ChatBot(nodeSDK, scenario);
chatbot.start();

chatbot.onMessage((tag, step, content, from, done) => {
    console.log("::: On answer>", tag, step, content, from);

    if(tag === "routing" && step === "choice" && content === "yes") {
        done("end_no");   
    } else {
        done();
    }
}, this);

chatbot.onTicket((tag, history, from, start, end) => {
    console.log("::: On ticket>", tag, history, from, start, end);
}, this);


