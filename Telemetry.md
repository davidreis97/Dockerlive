# Telemetry

Dockerlive collects usage data using Azure Application Insights in order to help better understand the usage of the extension. If you don’t wish to send usage data, you can set the telemetry.enableTelemetry setting to false.

## Gathered events

- Number of executions of command `dockerlive.stop`
- Number of executions of command `dockerlive.restart`
- Number of executions of command `dockerlive.toggle`
- Number of executions of command `dockerlive.openShell`
- Time (in seconds) spent with the Filesystem webview in a visible state
- Time (in seconds) spent with the Performance webview in a visible state