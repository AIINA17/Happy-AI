import fs from "node:fs";
import path from "node:path";
import type { NextConfig } from "next";

// The Turbopack root must contain node_modules, or module resolution stops
// before reaching it. Local dev keeps it in frontend/, one level up; the
// Docker image installs it next to this file.
const turbopackRoot = fs.existsSync(path.join(__dirname, "node_modules"))
    ? __dirname
    : path.join(__dirname, "..");

const nextConfig: NextConfig = {
    output: "standalone",

    turbopack: {
        root: turbopackRoot,
    },

    images: {
        remotePatterns: [
            {
                protocol: "https",
                hostname: "**",
            },
        ],
    },
};

export default nextConfig;
