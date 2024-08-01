function transcribeVideoAudioWithNativeAPI(videoElement) {
  // Create an audio context
  const audioContext = new (window.AudioContext || window.webkitAudioContext)()

  // Create a media element source
  const mediaElementSource = audioContext.createMediaElementSource(videoElement)

  // Connect the source to the destination (output)
  mediaElementSource.connect(audioContext.destination)

  // Create a script processor node to capture audio data
  const scriptProcessor = audioContext.createScriptProcessor(4096, 1, 1)

  scriptProcessor.onaudioprocess = function (event) {
    const inputBuffer = event.inputBuffer
    const audioData = inputBuffer.getChannelData(0)

    // Send audioData to the server for transcription
    sendAudioDataToServer(audioData)
  }

  // Connect the script processor node to the source
  mediaElementSource.connect(scriptProcessor)
  scriptProcessor.connect(audioContext.destination)
}

function sendAudioDataToServer(audioData) {
  // Convert audioData to a format suitable for sending to the server
  const audioBlob = new Blob([audioData], { type: 'audio/wav' })

  // Create a FormData object to send the audio data
  const formData = new FormData()
  formData.append('audio', audioBlob, 'audio.wav')

  // Send the audio data to the server using fetch or XMLHttpRequest
  fetch('/transcribe', {
    method: 'POST',
    body: formData,
  })
    .then((response) => response.json())
    .then((data) => {
      console.log('Transcription:', data.transcription)
    })
    .catch((error) => {
      console.error('Error:', error)
    })
}

//server.js
const express = require('express')
const multer = require('multer')
const fs = require('fs')
const speech = require('@google-cloud/speech')

const app = express()
const upload = multer({ dest: 'uploads/' })

app.post('/transcribe', upload.single('audio'), async (req, res) => {
  const client = new speech.SpeechClient()

  const audio = {
    content: fs.readFileSync(req.file.path).toString('base64'),
  }

  const config = {
    encoding: 'LINEAR16',
    sampleRateHertz: 44100,
    languageCode: 'zh-CN',
  }

  const request = {
    audio: audio,
    config: config,
  }

  try {
    const [response] = await client.recognize(request)
    const transcription = response.results
      .map((result) => result.alternatives[0].transcript)
      .join('\n')
    res.json({ transcription })
  } catch (error) {
    console.error('Error:', error)
    res.status(500).json({ error: 'Transcription failed' })
  }
})

app.listen(3000, () => {
  console.log('Server is running on port 3000')
})
