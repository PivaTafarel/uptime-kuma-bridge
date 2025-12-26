import { io, Socket } from "socket.io-client"
import cors from "cors"
import express from "express"

const PORT = process.env.PORT || 3000

const app = express()
app.use(cors())
app.use(express.json())

/**
 * Keep track of all active sockets, monitors, ...
 * One per URI
 */
const sockets: {
  [uri: string]: { socket: Socket; monitors: { [id: string]: any } }
} = {}

/**
 * Connect to a Socket.IO server
 */
const connectSocket = async (
  uri: string,
  credentials: { username: string; password: string }
): Promise<Socket> => {
  return new Promise((resolve, reject) => {
    if (sockets[uri]) {
      return resolve(sockets[uri].socket)
    }

    const socket = io(uri, {
      transports: ["websocket"],
      reconnection: true,
    })

    sockets[uri] = { socket, monitors: [] }

    socket.on("connect", () => {
      console.log("✅ Connected Socket.IO:", socket.id)
    })

    socket.on("disconnect", (reason) => {
      console.log("❌ Disconnected Socket.IO:", reason)
      reject(reason)
    })

    socket.on("monitorList", (data) => {
      console.log("📋 Monitor list received")
      sockets[uri].monitors = data
    })

    socket.on("updateMonitorIntoList", (data) => {
      data = Object.values(data)[0]
      console.log("🔄 Monitor updated:", data.id)
      sockets[uri].monitors[data.id] = data
    })

    socket.on("deleteMonitorFromList", (monitorId) => {
      console.log("🗑️ Monitor deleted:", monitorId)
      delete sockets[uri].monitors[monitorId]
    })

    socket.on("loginRequired", () => {
      console.log("🔑 Login required")

      socket.emit("login", credentials, (response: any) => {
        if (response.ok) {
          console.log("🔑 Login successful")
          return resolve(socket)
        }

        console.log("🔑 Login failed")
        reject("Login failed")
      })
    })
  })
}

/**
 * HTTP → Socket.IO com ACK
 */
app.post("/emit", async (req, res) => {
  const { uri, credentials, event, payload, timeout = 5000 } = req.body

  if (!uri || !credentials || !event || !payload) {
    return res.status(400).json({
      error: "`uri`, `credentials`, `event`, and `payload` are required",
    })
  }

  const timeoutTimer = setTimeout(() => {
    res.status(504).json({
      error: "ACK timeout",
      event,
    })
  }, timeout)

  console.log("📋 Emitting event:", event)
  const socket = await connectSocket(uri, credentials)
  if (!socket.connected) {
    return res.status(503).json({ error: "Socket.IO disconnected" })
  }

  socket.emit(event, payload ?? {}, (ack: any) => {
    clearTimeout(timeoutTimer)

    if (!ack.ok) {
      return res.status(400).json(ack)
    }

    res.json(ack)
  })
})

/**
 * HTTP → List Monitors
 */
app.post("/monitors", async (req, res) => {
  const { uri, credentials } = req.body

  if (!uri || !credentials) {
    return res.status(400).json({
      error: "`uri` and `credentials` are required",
    })
  }

  console.log("📋 Listing monitors...")
  const socket = await connectSocket(uri, credentials)
  if (!socket.connected) {
    return res.status(503).json({ error: "Socket.IO disconnected" })
  }

  res.json(Object.values(sockets[uri].monitors))
})

/**
 * HTTP → List Groups
 */
app.post("/groups", async (req, res) => {
  const { uri, credentials } = req.body

  if (!uri || !credentials) {
    return res.status(400).json({
      error: "`uri` and `credentials` are required",
    })
  }

  console.log("📋 Listing groups...")
  const socket = await connectSocket(uri, credentials)
  if (!socket.connected) {
    return res.status(503).json({ error: "Socket.IO disconnected" })
  }

  res.json(
    Object.values(sockets[uri].monitors)
      .filter((m) => m.type === "group")
      .map((group) => ({
        id: group.id,
        name: group.name,
      }))
  )
})

/**
 * Start the Express server
 */
app.listen(PORT, () => {
  console.log(`🚀 Bridge running on port ${PORT}`)
})
