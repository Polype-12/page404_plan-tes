import { FileLoader, Loader } from 'three';
import {
	createGaussianSplatGeometry,
	writeColorBytes,
	writeCovariance
} from 'three/addons/utils/GaussianSplatUtils.js';

// Loader for the SuperSplat / PlayCanvas "compressed" PLY format
// (*.compressed.ply): splats are grouped in chunks of 256, each chunk storing
// min/max bounds, and every splat packs position, rotation, scale and color
// into four uint32s quantized against its chunk's bounds.
// Spherical harmonics (optional "sh" element) are ignored.

const CHUNK_SIZE = 256;

class CompressedPLYLoader extends Loader {

	load( url, onLoad, onProgress, onError ) {

		const loader = new FileLoader( this.manager );
		loader.setPath( this.path );
		loader.setResponseType( 'arraybuffer' );
		loader.setRequestHeader( this.requestHeader );
		loader.setWithCredentials( this.withCredentials );

		loader.load( url, ( data ) => {

			try {

				onLoad( this.parse( data ) );

			} catch ( e ) {

				if ( onError ) onError( e ); else console.error( e );
				this.manager.itemError( url );

			}

		}, onProgress, onError );

	}

	parse( buffer ) {

		const { elements, dataOffset } = parseHeader( buffer );

		const chunkElement = elements.find( ( e ) => e.name === 'chunk' );
		const vertexElement = elements.find( ( e ) => e.name === 'vertex' );

		if ( ! chunkElement || ! vertexElement || ! vertexElement.properties.includes( 'packed_position' ) ) {

			throw new Error( 'CompressedPLYLoader: not a compressed PLY file.' );

		}

		// Elements are stored back to back; locate each one's data.
		const view = new DataView( buffer );
		let offset = dataOffset;
		let chunkOffset = 0, vertexOffset = 0;

		for ( const element of elements ) {

			if ( element === chunkElement ) chunkOffset = offset;
			if ( element === vertexElement ) vertexOffset = offset;
			offset += element.count * element.stride;

		}

		const chunkProps = chunkElement.properties;
		const chunkFloats = chunkProps.length;
		const chunks = new Float32Array( chunkElement.count * chunkFloats );

		for ( let i = 0; i < chunks.length; i ++ ) {

			chunks[ i ] = view.getFloat32( chunkOffset + i * 4, true );

		}

		const c = ( name ) => chunkProps.indexOf( name );
		const iMinX = c( 'min_x' ), iMinY = c( 'min_y' ), iMinZ = c( 'min_z' );
		const iMaxX = c( 'max_x' ), iMaxY = c( 'max_y' ), iMaxZ = c( 'max_z' );
		const iMinSX = c( 'min_scale_x' ), iMinSY = c( 'min_scale_y' ), iMinSZ = c( 'min_scale_z' );
		const iMaxSX = c( 'max_scale_x' ), iMaxSY = c( 'max_scale_y' ), iMaxSZ = c( 'max_scale_z' );
		const iMinR = c( 'min_r' ), iMinG = c( 'min_g' ), iMinB = c( 'min_b' );
		const iMaxR = c( 'max_r' ), iMaxG = c( 'max_g' ), iMaxB = c( 'max_b' );
		const hasColorBounds = iMinR !== - 1;

		const vertexProps = vertexElement.properties;
		const oPos = vertexProps.indexOf( 'packed_position' ) * 4;
		const oRot = vertexProps.indexOf( 'packed_rotation' ) * 4;
		const oScale = vertexProps.indexOf( 'packed_scale' ) * 4;
		const oColor = vertexProps.indexOf( 'packed_color' ) * 4;

		const count = vertexElement.count;
		const centers = new Float32Array( count * 3 );
		const covariances = new Float32Array( count * 6 );
		const colors = new Uint8ClampedArray( count * 4 );
		const q = [ 0, 0, 0, 0 ];

		for ( let i = 0; i < count; i ++ ) {

			const base = vertexOffset + i * vertexElement.stride;
			const ch = Math.floor( i / CHUNK_SIZE ) * chunkFloats;

			// position (11/10/11 bits)
			const p = view.getUint32( base + oPos, true );
			centers[ i * 3 ] = lerp( chunks[ ch + iMinX ], chunks[ ch + iMaxX ], unorm( p >>> 21, 11 ) );
			centers[ i * 3 + 1 ] = lerp( chunks[ ch + iMinY ], chunks[ ch + iMaxY ], unorm( p >>> 11, 10 ) );
			centers[ i * 3 + 2 ] = lerp( chunks[ ch + iMinZ ], chunks[ ch + iMaxZ ], unorm( p, 11 ) );

			// rotation: "smallest three" encoding, 2 bits for the largest component index
			const r = view.getUint32( base + oRot, true );
			const norm = Math.SQRT2;
			const a = ( unorm( r >>> 20, 10 ) - 0.5 ) * norm;
			const b = ( unorm( r >>> 10, 10 ) - 0.5 ) * norm;
			const cc = ( unorm( r, 10 ) - 0.5 ) * norm;
			const m = Math.sqrt( Math.max( 0, 1 - ( a * a + b * b + cc * cc ) ) );
			const largest = r >>> 30;
			let k = 0;
			for ( let j = 0; j < 4; j ++ ) q[ j ] = j === largest ? m : [ a, b, cc ][ k ++ ];
			// q is ( w, x, y, z ), matching rot_0..rot_3

			// scale (11/10/11 bits, log space)
			const s = view.getUint32( base + oScale, true );
			const sx = Math.exp( lerp( chunks[ ch + iMinSX ], chunks[ ch + iMaxSX ], unorm( s >>> 21, 11 ) ) );
			const sy = Math.exp( lerp( chunks[ ch + iMinSY ], chunks[ ch + iMaxSY ], unorm( s >>> 11, 10 ) ) );
			const sz = Math.exp( lerp( chunks[ ch + iMinSZ ], chunks[ ch + iMaxSZ ], unorm( s, 11 ) ) );

			writeCovariance( covariances, i * 6, sx, sy, sz, q[ 1 ], q[ 2 ], q[ 3 ], q[ 0 ] );

			// color (8/8/8/8 bits): already 0.5 + SH_C0 * f_dc, alpha already sigmoid'ed
			const col = view.getUint32( base + oColor, true );
			let cr = unorm( col >>> 24, 8 ), cg = unorm( col >>> 16, 8 ), cb = unorm( col >>> 8, 8 );

			if ( hasColorBounds ) {

				cr = lerp( chunks[ ch + iMinR ], chunks[ ch + iMaxR ], cr );
				cg = lerp( chunks[ ch + iMinG ], chunks[ ch + iMaxG ], cg );
				cb = lerp( chunks[ ch + iMinB ], chunks[ ch + iMaxB ], cb );

			}

			writeColorBytes( colors, i * 4, cr * 255, cg * 255, cb * 255, unorm( col, 8 ) * 255 );

		}

		return createGaussianSplatGeometry( centers, covariances, colors );

	}

}

const TYPE_SIZES = {
	char: 1, uchar: 1, int8: 1, uint8: 1,
	short: 2, ushort: 2, int16: 2, uint16: 2,
	int: 4, uint: 4, int32: 4, uint32: 4, float: 4, float32: 4,
	double: 8, float64: 8
};

function parseHeader( buffer ) {

	const bytes = new Uint8Array( buffer, 0, Math.min( buffer.byteLength, 64 * 1024 ) );
	const text = new TextDecoder().decode( bytes );
	const end = text.indexOf( 'end_header\n' );

	if ( ! text.startsWith( 'ply' ) || end === - 1 ) throw new Error( 'CompressedPLYLoader: missing PLY header.' );
	if ( ! text.includes( 'binary_little_endian' ) ) throw new Error( 'CompressedPLYLoader: only binary_little_endian is supported.' );

	const elements = [];

	for ( const line of text.slice( 0, end ).split( '\n' ) ) {

		const parts = line.trim().split( /\s+/ );

		if ( parts[ 0 ] === 'element' ) {

			elements.push( { name: parts[ 1 ], count: parseInt( parts[ 2 ] ), properties: [], stride: 0 } );

		} else if ( parts[ 0 ] === 'property' ) {

			const element = elements[ elements.length - 1 ];
			element.properties.push( parts[ 2 ] );
			element.stride += TYPE_SIZES[ parts[ 1 ] ];

		}

	}

	return { elements, dataOffset: end + 'end_header\n'.length };

}

function unorm( value, bits ) {

	const max = ( 1 << bits ) - 1;
	return ( value & max ) / max;

}

function lerp( a, b, t ) {

	return a + ( b - a ) * t;

}

export { CompressedPLYLoader };
