// server.js
const express = require("express");
const http = require("http");
const { Storage } = require("@google-cloud/storage");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const socketIo = require("socket.io");
const { SpeechClient } = require("@google-cloud/speech");
const fs = require("fs");
const path = require("path");
const cors = require("cors");
require("dotenv").config();
process.env.GOOGLE_APPLICATION_CREDENTIALS = "tourism-app-service-account.json";

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "http://localhost:5173", 
    methods: ["GET", "POST"],
  },
});
const port = 8080;


const speechClient = new SpeechClient();
const storage = new Storage();
const bucketName = "your storage bucket name";
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

app.use(express.json());
app.use(
  cors({
    origin: "http://localhost:5173", // Allow requests from this origin
  })
);


io.on("connection", (socket) => {
  console.log("Client Connected to the  audio Transcription");

  let audioFilePath = path.join(__dirname, "audio2.wav");//where to save your file temporary before upstream to storage bucket
  let writeStream = fs.createWriteStream(audioFilePath);

  socket.on("audio-chunk", (chunk) => {
    console.log("Received audio chunk");
    writeStream.write(chunk);
  });

  socket.on("stop-recording", async () => {
    console.log("Stop recording received");
    writeStream.end();

    writeStream.on("finish", async () => {
      try {
        // Upload the file to Google Cloud Storage
        await storage.bucket(bucketName).upload(audioFilePath, {
          destination: "audio2.wav",
        });

        const gcsUri = `gs://${bucketName}/audio2.wav`;

        const request = {
          audio: { uri: gcsUri },
          config: {
            model: "default",
            encoding: "WEBM_OPUS",
            sampleRateHertz: 48000,
            audioChannelCount: 1,
            enableWordTimeOffsets: true,
            languageCode: "en-KE",
          },
        };

        const [response] = await speechClient.recognize(request);
        const transcription = response.results
          .map((result) => result.alternatives[0].transcript)
          .join("\n");
          console.log("Responses",response.results)
        console.log(`Transcription: ${transcription}`);

        // Emit the transcription back to the client
        socket.emit("transcription", transcription);

        // Delete the audio file after transcription
        fs.unlinkSync(audioFilePath);
      } catch (error) {
        console.error("Error during transcription:", error);
        socket.emit("error", "Error Processing Audio");
      }
    });
  });

  socket.on("disconnect", () => {
    console.log("Client disconnected");
    if (writeStream) {
      writeStream.end();
    }
  });
});
// Helper function to generate prompt
function generatePrompt(place) {
  return `Tell me about ${place}, focusing on:
    1. Its historical significance
    2. Why people love visiting it
    3. Interesting facts and cultural impact
    4. Notable architectural or design elements
    Please provide detailed but concise information.`;
}

app.post("/api/place-info", async (req, res) => {
  try {
    const { place } = req.body;
    if (!place) {
      return res.status(400).json({ error: "Place name is required" });
    }

    // Initialize the model
    const model = genAI.getGenerativeModel({ model: "gemini-pro" });

    // Generate content
    const prompt = generatePrompt(place);
    const result = await model.generateContent(prompt);
    const response = result.response;
    console.log("Response print",response.text())

    res.json({
      place,
      information: response.text(),
    });
  } catch (error) {
    console.error("Error:", error);
    res.status(500).json({ error: "Failed to get place information" });
  }
});

server.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
