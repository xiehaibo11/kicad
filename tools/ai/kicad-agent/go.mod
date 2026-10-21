module github.com/zhoushoujianwork/easyeda-agent/kicad-agent

go 1.26.3

require (
	github.com/spf13/cobra v1.10.2
	github.com/zhoushoujianwork/easyeda-agent v0.0.0
	google.golang.org/protobuf v1.36.6
)

require (
	github.com/inconshreveable/mousetrap v1.1.0 // indirect
	github.com/spf13/pflag v1.0.9 // indirect
)

replace github.com/zhoushoujianwork/easyeda-agent => ../upstream/easyeda-agent
