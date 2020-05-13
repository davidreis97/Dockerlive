import { DynamicAnalysis } from './dynamicAnalysis';

interface ExecData {
	output: Buffer,
	exitCode: number
}

export function execWithStatusCode(this: DynamicAnalysis, cmd): Promise<ExecData> {
	return new Promise((res, _rej) => {
		this.container.exec({ Cmd: cmd, AttachStdout: true, AttachStderr: true }, (err, exec) => {
			if (this.isDestroyed) {
				return;
			}

			if (err) {
				this.debugLog("ERROR CREATING EXEC", cmd, err);
				res(null);
				return;
			}

			let outputBuffers = [];

			exec.start((err, stream) => {
				if (this.isDestroyed) {
					return;
				}

				if (err) {
					this.debugLog("ERROR STARTING EXEC", cmd, err);
					res(null);
					return;
				}

				stream.on('data', async (data: Buffer) => {
					outputBuffers.push(data);
					await new Promise(r => setTimeout(r, 100)); //!- Temporary workaround. See stream.on('end')

					if (this.isDestroyed) {
						return;
					}

					exec.inspect((err, data) => {
						if (this.isDestroyed) {
							return;
						}

						if (err) {
							this.debugLog("ERROR INSPECTING EXEC", cmd, err);
							res(null);
							return;
						}

						if (!data.Running) {
							res({
								output: Buffer.concat(outputBuffers),
								exitCode: data.ExitCode
							});
						}
					});
				});

				//! - Due to a bug in Dockerode/Docker API, the end event is not being triggered, hence the necessity to inspect the exec every time data is received
				//! - https://github.com/apocas/dockerode/issues/534
				stream.on('end', () => {
					this.debugLog("EXEC END");
				})
			});
		});
	});
}