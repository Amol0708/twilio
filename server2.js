require("dotenv").config();
const express = require("express");
const bodyParser = require("body-parser");
const twilio = require("twilio");
const mongoose = require("mongoose");
const cron = require("node-cron");
const moment = require("moment");
const { configDotenv } = require("dotenv");

const app = express();
const port = process.env.PORT || 3000;

// MongoDB Connection
mongoose.connect(
    "mongodb+srv://awsdiscounts:KQrliUmspGZ9ZHEe@itsm.dapwc.mongodb.net/?retryWrites=true&w=majority&appName=itsm",
    { useNewUrlParser: true, useUnifiedTopology: true }
)
    .then(() => console.log("MongoDB connected"))
    .catch((err) => console.error("MongoDB connection error:", err));

// Define Task Schema (previously Ticket)
const taskSchema = new mongoose.Schema({
    "WO#": Number,
    "Case#": Number,
    "City": String,
    "Customer Mobile Number": Number,
    "Service Completion Date": String, // Stored in "DD-MMM-YYYY hh:mm A" format
    "Tech Assignment": String, // FSE Username as Tech Assignment
    "Customer Name": String, // Customer's name
    "Satisfaction_Score": { type: Number, default: null },  // Added field to store the score
    "Satisfaction_Comment": { type: String, default: null },  // Added field to store the comment
    "State": String,  // New field for State
    "State Location": String,  // New field for State Location
    "PUDO ID": String,  // New field for PUDO ID
    "Indian Regions": String, // Added field for Indian Regions
    "Vendor Id": Number, // New field for Vendor Id
    "Customer Postal Code": Number, // New field for Postal Code
    "Indian Region": String
});

// Model for Task collection (use singular collection name explicitly)
const Task = mongoose.model("Task", taskSchema, "Task"); // Use 'Task' collection instead of default 'tasks'

// Define the T3B schema for storing transferred data
const t3BSchema = new mongoose.Schema({
    "WO#": Number,
    "Case#": Number,
    "City": String,
    "Customer Mobile Number": Number,
    "Service Completion Date": String,
    "Tech Assignment": String,
    "Customer Name": String,
    "Satisfaction_Score": Number,
    "Satisfaction_Comment": String,
    "State": String,  // New field for State
    "State Location": String,  // New field for State Location
    "PUDO ID": String,  // New field for PUDO ID
    "Vendor Id": Number,  // New field for Vendor Id
    "Customer Postal Code": Number, // New field for Postal Code
    "Indian Region": String
});

// Model for T3B collection (use singular collection name explicitly)
const T3B = mongoose.model("T3B", t3BSchema, "T3B"); // Use 'T3B' collection instead of default 't3bs'

// Initialize Express App
app.use(bodyParser.urlencoded({ extended: false }));
const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

// Global object to store active session for WO# tracking
let activeSessions = {};

// Cron job to check service completion date
cron.schedule("* * * * *", async () => {
    const now = moment(); // Get the current time
    const tasks = await Task.find({}); // Fetch all tasks (was tickets previously)
    console.log(`[Cron] Checking service completion date at ${now.format()}`);

    tasks.forEach(task => {
        const serviceDate = moment(task["Service Completion Date"], "DD-MMM-YYYY hh:mm A");
        console.log(`[Cron] Checking Task WO#: ${task["WO#"]}, Service Date: ${serviceDate.format()}`);

        // Check if the service date matches the current time
        if (serviceDate.isSame(now, 'minute')) {
            console.log(`[Cron] Task WO#: ${task["WO#"]} matches the current time, initiating feedback.`);
            sendFeedback(task);
        }
    });
});

// Function to send feedback request
async function sendFeedback(task) {
    const fseUsername = task["Tech Assignment"];
    const customerNumber = task["Customer Mobile Number"];
    const customerName = task["Customer Name"];
    const woNumber = task["WO#"];
    const question1 = `We’d love to hear about your experience with our Field Service Engineer, ${fseUsername}, ${woNumber}. Could you please take a moment to rate their service? Your feedback means a lot to us! 
8️⃣: Good 🙂 
9️⃣: Very Good 😊 
🔟: Excellent 😃`;

    // Format the phone number for WhatsApp
    const formattedNumber = `+${customerNumber}`;

    try {
        console.log(`[Feedback] Sending greeting message to ${formattedNumber} for WO#: ${woNumber}`);
        await client.messages.create({
            body: `Hello ${customerName}, we would like to get your feedback on WO# ${woNumber}.`,
            from: 'whatsapp:+14155238886', // Your Twilio WhatsApp number
            to: `whatsapp:${formattedNumber}`,
        });

        activeSessions[formattedNumber] = { woNumber, stage: 1 };

        console.log(`[Feedback] Sending feedback question 1 to ${formattedNumber}`);
        setTimeout(() => {
            client.messages.create({
                body: question1,
                from: 'whatsapp:+14155238886',
                to: `whatsapp:${formattedNumber}`,
            });
        }, 2000);
    } catch (error) {
        console.error(`[Feedback] Error sending feedback to ${formattedNumber}:`, error);
    }
}

// Feedback response handling
app.post("/webhook", async (req, res) => {
    const incomingMsg = req.body.Body.trim();
    const fromNumber = req.body.From.replace("whatsapp:", "");

    console.log(`[Response] Received message from ${fromNumber}: ${incomingMsg}`);

    const response = new twilio.twiml.MessagingResponse();

    if (!activeSessions[fromNumber]) {
        console.log(`[Response] No active session for ${fromNumber}.`);
        response.message("Please provide feedback only after we initiate the process with your specific WO#.");
        return res.set("Content-Type", "text/xml").send(response.toString());
    }

    const session = activeSessions[fromNumber];
    const woNumber = session.woNumber;

    try {
        console.log(`[Response] Fetching Task for WO#: ${woNumber}`);
        const task = await Task.findOne({ "WO#": woNumber });
        
        if (!task) {
            console.log(`[Response] Task WO#: ${woNumber} not found in Task collection.`);
            response.message("WO# not found.");
            return res.set("Content-Type", "text/xml").send(response.toString());
        }

        console.log(`[Response] Task for WO#: ${woNumber} found in Task collection.`);

        console.log(`[Response] Active session found for WO#: ${woNumber}, Stage: ${session.stage}`);

        if (session.stage === 1) {
            if (/^8$|^9$|^10$/.test(incomingMsg)) {
                const rating = parseInt(incomingMsg, 10);
                console.log(`[Response] Received rating for WO#: ${woNumber}: ${rating}`);

                task.Satisfaction_Score = rating;
                await task.save(); // Update only Satisfaction_Score
                console.log(`[Response] Updated Satisfaction_Score for WO#: ${woNumber}`);

                activeSessions[fromNumber].stage = 2;

                let feedbackMessage = `Thank you for your wonderful feedback! We are glad you had a great experience. Please provide any additional comments or suggestions.`;

                response.message(`For WO# ${woNumber}, ${feedbackMessage}`);
            } else {
                console.log(`[Response] Invalid rating received for WO#: ${woNumber}`);
                response.message(`WO# ${woNumber} - Please enter a valid rating: 8, 9, or 10.`);
            }
        } else if (session.stage === 2) {
            console.log(`[Response] Received comment for WO#: ${woNumber}: ${incomingMsg}`);

            task.Satisfaction_Comment = incomingMsg;
            await task.save(); // Update only Satisfaction_Comment
            console.log(`[Response] Updated Satisfaction_Comment for WO#: ${woNumber}`);

            const taskData = task.toObject();
            delete taskData._id;

            console.log(`[Response] Transferring updated data for WO#: ${woNumber} to T3B collection.`);
            await T3B.updateOne(
                { "WO#": woNumber },
                { $set: taskData },
                { upsert: true }
            ); // Update the T3B collection with the updated task data

            console.log(`[Response] Updated T3B collection for WO#: ${woNumber}`);
            response.message(`WO# ${woNumber} - Thank you for your comments! Your feedback has been recorded.`);
            delete activeSessions[fromNumber];

        }
    } catch (error) {
        console.error(`[Response] Error handling feedback for WO#: ${woNumber}:`, error);
        response.message(`WO# ${woNumber} - An error occurred while processing your feedback.`);
    }

    res.set("Content-Type", "text/xml");
    res.send(response.toString());
});

// Start Server
app.listen(port, () => {
    console.log(`Server running on port ${port}`);
});
