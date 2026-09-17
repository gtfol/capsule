#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
xcodebuild -version
simulator_id=$(xcrun simctl list devices available --json | python3 -c '
import json, sys
runtimes = json.load(sys.stdin)["devices"]
for runtime in sorted(runtimes, reverse=True):
    if "iOS" not in runtime:
        continue
    for device in runtimes[runtime]:
        if device.get("isAvailable") and device["name"].startswith("iPhone"):
            print(device["udid"])
            sys.exit(0)
sys.exit("Install an iOS simulator runtime in Xcode Settings > Components.")
')
xcodebuild -project CapsuleScan.xcodeproj -scheme CapsuleScan -destination 'generic/platform=iOS Simulator' -derivedDataPath DerivedData CODE_SIGNING_ALLOWED=NO build
xcodebuild -project CapsuleScan.xcodeproj -scheme CapsuleScan -destination 'generic/platform=iOS' -derivedDataPath DerivedData CODE_SIGNING_ALLOWED=NO build
xcrun simctl bootstatus "$simulator_id" -b
xcodebuild -project CapsuleScan.xcodeproj -scheme CapsuleScan -parallel-testing-enabled NO -destination "platform=iOS Simulator,id=$simulator_id" -derivedDataPath DerivedData -resultBundlePath TestResults.xcresult CODE_SIGNING_ALLOWED=NO test
