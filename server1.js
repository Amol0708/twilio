require("dotenv").config(); // Ensure this is at the top of your file
const express = require("express");
const bodyParser = require("body-parser");
const twilio = require("twilio");
const mongoose = require("mongoose");
const cron = require("node-cron");

const app = express();
const port = process.env.PORT || 3000;

// MongoDB Connection
mongoose
  .connect(
    "mongodb+srv://awsdiscounts:KQrliUmspGZ9ZHEe@itsm.dapwc.mongodb.net/?retryWrites=true&w=majority&appName=itsm",
    { useNewUrlParser: true, useUnifiedTopology: true }
  )
  .then(() => {
    console.log("[MongoDB] MongoDB connected successfully.");
  })
  .catch((err) => {
    console.error("[MongoDB] Error connecting to MongoDB:", err);
  });

// Define User Schema for the 'users' collection
const userSchema = new mongoose.Schema({
  username: { type: String, required: true },
  contactNumber: { type: Number, required: true },
  role: { type: String, enum: ["admin", "field-engineer"], required: true },
});

const User = mongoose.model("User", userSchema, "users");

// Define Task Schema
const taskSchema = new mongoose.Schema({
  "WO#": Number,
  "Case#": Number,
  City: String,
  Status: String,
  "Customer Mobile Number": Number,
  "Tech Assignment": String,
  "Customer Name": String,
  "Admin User": String,
  State: String,
  "State Location": String,
  "PUDO ID": String,
  "Indian Regions": String,
  "Vendor Id": Number,
  "Customer Postal Code": Number,
  "Indian Region": String,
  "Problem Description": String,
  "Customer Requested Appointment Date": String,
  "Pause Reason": String,
  statusNotified: { type: Boolean, default: false },
  lastNotified: Date,
  lastStatus: String,
});

const Task = mongoose.model("Task", taskSchema, "Task");

// Initialize Express App
app.use(bodyParser.urlencoded({ extended: false }));

const client = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
); // Fetch Twilio keys from .env

const sendStatusNotification = async (task) => {
  const customerNumber = task["Customer Mobile Number"];
  const customerName = task["Customer Name"];
  const woNumber = task["WO#"];
  const status = task.Status;
  const fseName = task["Tech Assignment"]; // Assuming "Tech Assignment" is the FSE's full name
  const adminUser = task["Admin User"];
  const problemDescription = task["Problem Description"];
  const customerRequestedDate = task["Customer Requested Appointment Date"];
  const pauseReason = task["Pause Reason"];
  const companyName = "Jetking"; // Replace with your actual company name

  // Get User Info for Admin and FSE
  const adminUserInfo = await User.findOne({ username: adminUser });
  const fseUserInfo = await User.findOne({ username: fseName });

  if (!adminUserInfo || !fseUserInfo) {
    console.log("Admin or FSE user not found!");
    return;
  }

  const adminNumber = adminUserInfo.contactNumber;
  const fseNumber = fseUserInfo.contactNumber;

  // Log User Details
  console.log(`[sendStatusNotification] Admin User: ${adminUser}, Admin Number: ${adminNumber}`);
  console.log(`[sendStatusNotification] FSE User: ${fseName}, FSE Number: ${fseNumber}`);
  console.log(`[sendStatusNotification] Customer: ${customerName}, Customer Number: ${customerNumber}`);

  // Define status-based messages
  const statusMessages = {
    "Technician Assigned": {
      admin: `Hello Admin,\n\nField Service Engineer ${fseName} has been assigned to Work Order No. ${woNumber} for customer ${customerName} regarding the issue: ${problemDescription}.\n\nThe technician will visit the customer on ${task["Customer Requested Appointment Date"]} between 10 AM to 6 PM.\n\n Jetking Team`,
      fse: `Hello ${fseName},\n\nYou have been assigned to Work Order No. ${woNumber} for customer ${customerName} regarding the issue: ${problemDescription}.\n\nPlease ensure to visit the customer on ${task["Customer Requested Appointment Date"]} between 10 AM to 6 PM.\n\n Jetking Team`,
      customer: `Dear ${customerName},\n\nWe are pleased to inform you that a technician has been assigned to your service request (Work Order: WO#${woNumber}). Our technician will visit your location on the requested appointment date, ${customerRequestedDate}, Our FSE Reach between 10 AM to 6 PM.\n\nThank you for choosing us!\nBest regards, Jetking Team`,
    },
  
    "En Route": {
      admin: `Hello Admin,\n\nField Service Engineer ${fseName} is en route to customer ${customerName} for Work Order No. ${woNumber}.\n\n Jetking Team`,
      fse: `Hello ${fseName},\n\nYou are en route to customer ${customerName} for Work Order No. ${woNumber}. Please ensure you arrive on time and assist the customer as needed.Jetking Team`,
      customer: `Dear ${customerName},\n\nOur technician is now en route to your location for your service request (Work Order: WO#${woNumber}). They will arrive shortly to assist you.\nPlease be ready to assist them with any questions or access to the required areas.\n\nThank you!\nBest regards, Jetking Team`,
    },
  
    "On Site": {
      admin: `Hello Admin,\n\nField Service Engineer ${fseName} has Been Reach  on site for customer ${customerName} regarding Work Order No. ${woNumber}.\n\n ${companyName}`,
      fse: `Hello ${fseName},\n\nYou have arrived on site for customer ${customerName} regarding Work Order No. ${woNumber}. Please begin the work and let the customer know if they need any further assistance.`,
      customer: `Dear ${customerName},\n\nOur technician has arrived at your location for your service request (Work Order: WO#${woNumber}) and is ready to begin the work.\nPlease let us know if you need any further assistance.\n\nThank you for your patience!\nBest regards, Jetking Team`,
    },
  
    "Pause": {
      admin: `Hello Admin,\n\nWork on Work Order No. ${woNumber} has been paused due to ${pauseReason} by Field Service Engineer ${fseName} for customer ${customerName}. Reason for pause: ${task["Pause Reason"]}.\n\n ${companyName}`,
      fse: `Hello ${fseName},\n\nWork on Work Order No. ${woNumber} has been paused due to ${pauseReason} for customer ${customerName}. Reason for pause: ${task["Pause Reason"]}.\n\n ${companyName}`,
      customer: `Dear ${customerName},\n\nThe service on your work order (Work Order: WO#${woNumber}) has been  paused due to ${pauseReason} We will inform you once we resume the work.\n\nThank you for your understanding!\nBest regards, Jetking Team`,
    },
  
    "Fixed": {
      admin: `Hello Admin,\n\nField Service Engineer ${fseName} has completed the work for customer ${customerName} regarding Work Order No ${woNumber}.\n\n ${companyName}`,
      fse: `Hello ${fseName},\n\nThe task for Work Order No. ${woNumber} has been marked as completed for customer ${customerName}. Please ensure all documentation is completed.\n\n ${companyName}`,
      customer: `Dear ${customerName},\n\nWe are pleased to inform you that the issue related to your work order (Work Order: WO#${woNumber}) has been successfully resolved.\nPlease feel free to reach out if you have any questions or require further assistance.\n\nThank you for choosing us!\nBest regards, Jetking Team`,
    },
  };
  

  // Send WhatsApp message to Admin
  console.log(`[sendStatusNotification] Sending message to Admin ${adminUser} at ${adminNumber}...`);
  await client.messages.create({
    body: statusMessages[status].admin,
    from: "whatsapp:+14155238886",
    to: `whatsapp:+${adminNumber}`,
  });

  // Send WhatsApp message to FSE
  console.log(`[sendStatusNotification] Sending message to FSE ${fseName} at ${fseNumber}...`);
  await client.messages.create({
    body: statusMessages[status].fse,
    from: "whatsapp:+14155238886",
    to: `whatsapp:+${fseNumber}`,
  });

  // Send WhatsApp message to Customer
  console.log(`[sendStatusNotification] Sending message to Customer ${customerName} at ${customerNumber}...`);
  await client.messages.create({
    body: statusMessages[status].customer,
    from: "whatsapp:+14155238886",
    to: `whatsapp:+${customerNumber}`,
  });

  console.log(`[sendStatusNotification] Notification sent for WO#: ${woNumber}, Status: ${status}`);
};

// Cron job to check and send notifications every minute
cron.schedule("* * * * *", async () => {
  console.log("Checking for pending tasks...");

  const tasks = await Task.find();

  tasks.forEach(async (task) => {
    // Check if the status has changed compared to the last saved status
    if (task.Status !== task.lastStatus) {
      // Status has changed, reset notification flag
      task.statusNotified = false;
    }

    // Send notification if not already sent for the current status
    if (!task.statusNotified) {
      await sendStatusNotification(task);

      // Update task details after sending notification
      task.lastStatus = task.Status;
      task.statusNotified = true;
      task.lastNotified = new Date();
      await task.save();
    }
  });
});

// Start the server
app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});


