import { spawn } from "node:child_process"
import net from "node:net"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.resolve(__dirname, "..")
const requestedPort = Number.parseInt(process.env.PORT || "3000", 10)
const startPort = Number.isFinite(requestedPort) ? requestedPort : 3000

function isPortOpen(port) {
  return new Promise((resolve) => {
    const server = net.createServer()

    server.once("error", () => resolve(false))
    server.once("listening", () => {
      server.close(() => resolve(true))
    })
    server.listen(port, "0.0.0.0")
  })
}

async function findOpenPort(start) {
  for (let port = start; port < start + 50; port += 1) {
    if (await isPortOpen(port)) return port
  }

  throw new Error(`No open port found between ${start} and ${start + 49}.`)
}

function getNetworkAddress() {
  for (const addresses of Object.values(os.networkInterfaces())) {
    for (const address of addresses || []) {
      if (address.family === "IPv4" && !address.internal) {
        return address.address
      }
    }
  }

  return null
}

const port = await findOpenPort(startPort)
const networkAddress = getNetworkAddress()
const nextBin = path.join(rootDir, "node_modules", ".bin", "next")

console.log("")
console.log("ReadyAimGo Client Hub dev server")
console.log(`Open:        http://localhost:${port}`)
if (networkAddress) {
  console.log(`Network:     http://${networkAddress}:${port}`)
}
console.log("Env file:    .env.local")
console.log("")

const child = spawn(nextBin, ["dev", "--hostname", "0.0.0.0", "--port", String(port)], {
  cwd: rootDir,
  env: process.env,
  stdio: "inherit",
})

function stop(signal) {
  if (!child.killed) child.kill(signal)
}

process.on("SIGINT", () => stop("SIGINT"))
process.on("SIGTERM", () => stop("SIGTERM"))

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal)
    return
  }

  process.exit(code ?? 0)
})
