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
	permissions : number,
	uid : number,
	gid : number,
	size : number
	children : FilesystemEntryCollection
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

function processLayer(preliminaryFilesystemEntries : PreliminaryFilesystemEntry[]) : FilesystemEntryCollection{
	let collection : FilesystemEntryCollection = {};

	for(let entry of preliminaryFilesystemEntries){
		let splitPath = entry.path.split("/").filter((value,_index,_array) => value != null && value.length > 0);
		let currentCollection = collection;

		do{
			let nextSegment = splitPath.shift();

			if(splitPath.length > 0){

				currentCollection = currentCollection[nextSegment].children;
			}else{
				currentCollection[nextSegment] = entry.entry;
				break;
			}
		}while(splitPath.length > 0);
	}

	return collection;
}

//b overwrites a
function mergeLayers(a: FilesystemEntryCollection, b: FilesystemEntryCollection){
	let collection : FilesystemEntryCollection = {};

	function copyEntry(entry: FilesystemEntry, FilesystemEntryCollection){
		//TODO
	}

}

export function getFilesystem(this: DynamicAnalysis, imageID: string){
	let image = this.docker.getImage(imageID);

	let processedLayers = {};

	let processedLayersCumultive: [];

	image.get((err,stream) => {
		if(err){
			console.log("ERROR");
		}

		extractTarStream(stream, (header : tar_stream.Headers, content_stream: internal.PassThrough, nextLayer: Function) => {
			let layer = header.name.match(/.*(?=\/layer\.tar$)/);
			if(layer){
				let layerName = layer[0];
				let preliminaryFilesystemEntries : PreliminaryFilesystemEntry[] = [];
				
				extractTarStream(content_stream, (aufs_header : tar_stream.Headers, aufs_stream: internal.PassThrough, nextFile: Function) => {
					preliminaryFilesystemEntries.push({
						path: aufs_header.name,
						entry: {
							type: aufs_header.name.match(/(^|\/)\.wh(?!\.\.wh\.)/) ? "removal" : aufs_header.type, //Regex only matches for .wh.<file> and not for .wh..wh..opq
							size: aufs_header.size,
							permissions: aufs_header.mode,
							uid: aufs_header.uid,
							gid: aufs_header.gid,
							children: {}	
						}
					});

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

					processedLayers[layerName] = processLayer(preliminaryFilesystemEntries);
					nextLayer();
				})
			}else{
				nextLayer();
			}
		});
	})
}