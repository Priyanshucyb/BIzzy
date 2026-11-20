#!/bin/bash
# BizYour — one-click PREVIEW for Mac/Linux: loads the demo data (safe to run
# again — nothing duplicates) and starts the app at http://localhost:4000
cd "$(dirname "$0")/backend" || exit 1
if ! command -v node >/dev/null 2>&1; then
  echo ""; echo "  Node.js nahi mila. Pehle Node.js 22+ (LTS) install karo: https://nodejs.org"; echo ""
  read -r -p "  Enter dabao band karne ke liye..." _; exit 1
fi
NODE_MAJOR=$(node -p 'process.versions.node.split(".")[0]')
if [ "$NODE_MAJOR" -lt 22 ]; then
  echo ""; echo "  Node.js $(node -v) purana hai — BizYour ko Node 22 ya naya chahiye: https://nodejs.org"; echo ""
  read -r -p "  Enter dabao band karne ke liye..." _; exit 1
fi
if [ ! -d node_modules ]; then echo "  Pehli baar setup — packages install ho rahe hain..."; npm install --silent || exit 1; fi
echo ""; echo "  Demo data load ho raha hai..."
node seed-demo.js 2>/dev/null | grep -E "LOAD HO GAYA|pehle se" 
node seed-mart-demo.js 2>/dev/null | grep -E "LOAD HO GAYA|pehle se"
echo ""
echo "  BizYour chal raha hai:  http://localhost:4000   (band karne ke liye ye window band karo / Ctrl+C)"
echo ""
echo "  Buyer:   demo@businessos.app / demo1234"
echo "  Seller:  fresh@bizyour.demo    / demo1234   (doosri window: Private / Incognito)"
echo ""
( sleep 2; (command -v open >/dev/null && open http://localhost:4000) || (command -v xdg-open >/dev/null && xdg-open http://localhost:4000) ) >/dev/null 2>&1 &
node server.js 2>&1 | grep -v ExperimentalWarning | grep -v "trace-warnings"
