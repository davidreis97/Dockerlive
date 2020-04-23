import { DynamicAnalysis } from './dynamicAnalysis';
import tar_stream from 'tar-stream';
import internal = require('stream');

interface PreliminaryFilesystemEntry{
	path: string,
	entry: FilesystemEntry
}

interface FilesystemEntryCollection{
	[key: string] : FilesystemEntry
}

interface ProcessedLayer{
	id: string,
	fs: [FilesystemEntryCollection,FilesystemEntryCollection],
	size: number
}

interface FilesystemEntry{
	type : 
		| 'file'
		| 'link'
		| 'symlink'
		| 'character-device'
		| 'block-device'
		| 'directory'
		| 'fifo'
		| 'contiguous-file'
		| 'pax-header'
		| 'pax-global-header'
		| 'gnu-long-link-path'
		| 'gnu-long-path'
		| 'removal', //Special for .wh files which mark the deletion of files in the union FS
	permissions : PermissionObject,
	uid : number,
	gid : number,
	size : number
	children : FilesystemEntryCollection
}

interface Permissions{
	read: boolean,
	write: boolean,
	execute: boolean
}

interface PermissionObject{
	stringRep: string,
	octalRep: string,
	owner: Permissions,
	group: Permissions,
	other: Permissions
}

function extractTarStream(stream, entry_callback: Function, finish_callback?: Function){
	var extract = tar_stream.extract()

	extract.on('entry', (header, content_stream, next) => {
		entry_callback(header, content_stream, next);
		//content_stream.resume() // just auto drain the stream
	});

	if(finish_callback)
		extract.on('finish', ()=>{
			finish_callback();
		});

	stream.pipe(extract);
}

// Merges two filesystems and returns a filesystem with the resulting merge and a filesystem with just the changes
// b overwrites a
// !- TODO - CHECK IF IT WORKS WITH A FOLDER DELETION WITH OTHER FILES INSIDE IT
function mergeLayers(a : FilesystemEntryCollection, b: PreliminaryFilesystemEntry[]) : [FilesystemEntryCollection, FilesystemEntryCollection, number] {
	let mergedCollection : FilesystemEntryCollection;
	let changesCollection : FilesystemEntryCollection = {};
	let layerSize : number = 0;

	if (a)
		mergedCollection = JSON.parse(JSON.stringify(a));
	else
		mergedCollection = {};

	for(let entry of b){
		let splitPath = entry.path.split("/").filter((value,_index,_array) => value != null && value.length > 0);
		let currentMergedCollection = mergedCollection;
		let currentChangesCollection = changesCollection;

		do{
			let nextSegment = splitPath.shift();

			if(splitPath.length > 0){
				currentMergedCollection = currentMergedCollection[nextSegment].children;
				currentChangesCollection = currentChangesCollection[nextSegment].children;
			}else{
				if(currentMergedCollection[nextSegment]){
					if(entry.entry.type == "removal"){
						delete currentMergedCollection[nextSegment];
					}else{
						currentMergedCollection[nextSegment].gid = entry.entry.gid;
						currentMergedCollection[nextSegment].permissions = entry.entry.permissions;
						currentMergedCollection[nextSegment].uid = entry.entry.uid;
						currentMergedCollection[nextSegment].size = entry.entry.size;
						currentMergedCollection[nextSegment].type = entry.entry.type;
						if(!currentMergedCollection[nextSegment].children){
							currentMergedCollection[nextSegment].children = entry.entry.children
						}
					}
				}else{
					currentMergedCollection[nextSegment] = entry.entry;
				}
				
				layerSize += entry.entry.size;

				currentChangesCollection[nextSegment] = entry.entry;
			}
		}while(splitPath.length > 0);
	}

	return [mergedCollection,changesCollection,layerSize];
}

function parseDecimalPermissions(decimal: number) : PermissionObject{
	let binaryRep = decimal.toString(2).slice(-9);

	let stringRep = "";
	for(let i = 0; i < binaryRep.length; i++){
		if(binaryRep[i] == "0"){
			stringRep += "-";
		}else{
			if(i%3 == 0){
				stringRep += "r";
			}else if(i%3 == 1){
				stringRep += "w";
			}else if(i%3 == 2){
				stringRep += "x";
			}
		}
	}

	return {
		octalRep: decimal.toString(8).slice(-3),
		stringRep: stringRep,
		owner: {
			read: binaryRep[0] == "1", 
			write: binaryRep[1] == "1",
			execute: binaryRep[2] == "1"
		},
		group: {
			read: binaryRep[3] == "1", 
			write: binaryRep[4] == "1",
			execute: binaryRep[5] == "1"
		},
		other: {
			read: binaryRep[6] == "1", 
			write: binaryRep[7] == "1",
			execute: binaryRep[8] == "1"
		}
	};
}

export function getFilesystem(this: DynamicAnalysis, imageID: string){
	let image = this.docker.getImage(imageID);

	let preliminaryLayers = {}; // {layerID => preliminaryLayer}
	let processedLayers : ProcessedLayer[] = [];
	let manifest;

	if (this.isDestroyed) {
		return;
	}

	image.get((err,stream) => {
		if(err){
			console.log("ERROR");
		}

		if (this.isDestroyed) {
			return;
		}

		extractTarStream(stream, (header : tar_stream.Headers, content_stream: internal.PassThrough, nextLayer: Function) => {
			let layer = header.name.match(/.*(?=\/layer\.tar$)/);
			if(layer){
				let layerName = layer[0];
				let preliminaryFilesystemEntries : PreliminaryFilesystemEntry[] = [];

				extractTarStream(content_stream, (aufs_header : tar_stream.Headers, aufs_stream: internal.PassThrough, nextFile: Function) => {
					let path = aufs_header.name;

					let removal = false;
					if(path.match(/(^|\/)\.wh(?!\.\.wh\.)/)){  //Regex only matches for .wh.<file> and not for .wh..wh..opq
						removal = true;
						path = path.replace(".wh.","");
					}

					if(!path.match(/\.wh\.\.wh\./)){ //Matches for for .wh..wh.<file>
						preliminaryFilesystemEntries.push({
							path: path,
							entry: {
								type: removal ? "removal" : aufs_header.type,
								size: aufs_header.size,
								permissions: parseDecimalPermissions(aufs_header.mode),
								uid: aufs_header.uid,
								gid: aufs_header.gid,
								children: {}	
							}
						});
					}
					
					/* aufs_stream.on('data', (data) => {
						console.log(data.toString());
					}); */

					aufs_stream.on('end', () => {
						nextFile();
					});
					aufs_stream.resume();
				}, () => {
					//Ordering ensures that filesystem structure is created in a structurally safe order (e.g. not create file /etc/os_release before creating folder /etc)
					preliminaryFilesystemEntries.sort((a: PreliminaryFilesystemEntry, b: PreliminaryFilesystemEntry) => { 
						return a.path.split("/").length - b.path.split("/").length;
					});

					preliminaryLayers[layerName] = preliminaryFilesystemEntries;
					nextLayer();
				});
			}else if(header.name.match(/manifest\.json/)){
				let manifestBuffers : Buffer[] = [] 
				content_stream.on('data', (data) => {
					manifestBuffers.push(data);
				});

				content_stream.on('end', () => {
					let manifestBuffer = Buffer.concat(manifestBuffers);
					manifest = JSON.parse(manifestBuffer.toString());
					nextLayer();
				});
			}else{
				nextLayer();
			}
		}, () => {
			let orderedLayerIDs = manifest[0].Layers.map((value,_index,_arr) => value.match(/[0-9a-fA-F]+(?=\/)/)[0]);
			
			let previousLayer;
			for (let layerID of orderedLayerIDs){
				let newProcessedLayers = mergeLayers(previousLayer,preliminaryLayers[layerID]);
				processedLayers.push({id: layerID, fs: [newProcessedLayers[0],newProcessedLayers[1]], size: newProcessedLayers[2]});
				previousLayer = newProcessedLayers[0];
			}

			if (this.isDestroyed) {
				return;
			}
			
			this.sendFilesystemData(processedLayers);
		});
	})
}