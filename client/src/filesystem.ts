interface ProcessedLayer {
	id: string,
	fs: [FilesystemEntryCollection, FilesystemEntryCollection]
}

interface FilesystemEntryCollection {
	[key: string]: FilesystemEntry
}

interface FilesystemEntry {
	type:
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
	permissions: number,
	uid: number,
	gid: number,
	size: number
	children: FilesystemEntryCollection
}

// !- TODO change font dependency to local dependency
// !- TODO connect css and js
export class FilesystemVisualizer {
	getHTML(css,js,font) {
		return /*html*/`
			<!DOCTYPE html>
			<html lang="en">
			
			<head>
				<meta charset="UTF-8">
				<meta name="viewport" content="width=device-width, initial-scale=1.0">

				<link rel="stylesheet" type="text/css" href="${css}" />

				<title>Filesystem</title>
			</head>

			<body>
			<div class="table-wrapper">
				<div class="layerPicker">
					<select id="layers" name="layers" onchange="setDisplayedLayer(this.value)">
					</select>
					<button id="upLayerButton" onclick="upLayer()">Up</button>
					<button id="downLayerButton" onclick="downLayer()">Down</button>
				</div>
				<table id="filetable">
					<col width="10">
					<col width="80">
					<col width="80">
					<col width="80">
					<tr>
						<th align="left">C</th>
						<th align="left">Type</th>
						<th align="left">Size</th>
						<th align="left">Permissions</th>
						<th align="left">Name</th>
					</tr>
				</table>
			</div>

			<script src="${js}"> </script>
			</body>

			</html>
		`;
	}
}