NNG_PREFIX ?= $(HOME)/kicad-deps/nng-install
PREFIX ?= /usr/local
BIN := bin/kicad-agent

.PHONY: build build-ipc install proto test clean

build:
	mkdir -p bin
	go build -o $(BIN) ./cmd/kicad-agent

build-ipc:
	mkdir -p bin
	CGO_CFLAGS="-I$(NNG_PREFIX)/include" \
	CGO_LDFLAGS="$(NNG_PREFIX)/lib/libnng.a -lpthread -lm" \
	go build -tags nng -o $(BIN) ./cmd/kicad-agent

# Install the full terminal tool.  The CLI-only build cannot serve the 29 IPC
# actions, so `install` always uses the NNG build.
install: build-ipc
	install -d $(PREFIX)/bin
	install -m 0755 $(BIN) $(PREFIX)/bin/kicad-agent

proto:
	./proto/gen.sh

test:
	go test ./...

clean:
	rm -rf bin
