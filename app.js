// cPanel Node.js Application entry point
// This file is used by cPanel's "Setup Node.js App" feature as the Application startup file.
// It simply sets NODE_ENV=production and imports the built server.
process.env.NODE_ENV = "production";
import("./dist/boot.js");
