.PHONY: setup stack stack-down seed config tamper ios android

REPO_ROOT := $(shell cd ../../.. && pwd)

setup: stack seed config

stack:
	bash stack.sh

stack-down:
	-[ -f .stack-server.pid ] && kill $$(cat .stack-server.pid) 2>/dev/null || true
	-command -v lsof >/dev/null 2>&1 && lsof -ti tcp:8080 | xargs kill 2>/dev/null || true
	-rm -f .stack-server.pid
	cd $(REPO_ROOT)/backend && docker compose stop

seed:
	bash seed.sh

config:
	bash generate-config.sh

tamper:
	bash tamper.sh

ios:
	npx react-native run-ios --simulator "iPhone 17 Pro"

android:
	@if ! adb devices | grep -q emulator; then \
		echo "Booting emulator (Medium_Phone_API_35)..."; \
		nohup ~/Library/Android/sdk/emulator/emulator -avd Medium_Phone_API_35 >/dev/null 2>&1 & \
		adb wait-for-device; \
	fi
	adb reverse tcp:8080 tcp:8080
	# 9000 too: bootstrap returns a localhost:9000 CDN URL the device must reach
	adb reverse tcp:9000 tcp:9000
	npx react-native run-android
