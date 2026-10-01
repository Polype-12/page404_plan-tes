import './style.css';

import * as THREE from 'three/webgpu';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GaussianSplat } from 'three/addons/objects/GaussianSplat.js';
import { CompressedPLYLoader } from './CompressedPLYLoader.js';

THREE.ColorManagement.workingColorSpace = THREE.SRGBColorSpace;

let camera, scene, renderer, controls, splats;

init();

async function init() {

	camera = new THREE.PerspectiveCamera( 50, window.innerWidth / window.innerHeight, 0.01, 1000 );
	camera.position.set( 0, 1.5, 4 );

	scene = new THREE.Scene();
	scene.background = new THREE.Color( 0x07080f );

	renderer = new THREE.WebGPURenderer( { antialias: true } );
	renderer.setPixelRatio( window.devicePixelRatio );
	renderer.setSize( window.innerWidth, window.innerHeight );
	renderer.setAnimationLoop( animate );
	document.body.appendChild( renderer.domElement );

	await renderer.init();

	controls = new OrbitControls( camera, renderer.domElement );
	controls.enableDamping = true;

	// default cube in the middle
	const cube = new THREE.Mesh(
		new THREE.BoxGeometry( 1, 1, 1 ),
		new THREE.MeshStandardMaterial( { color: 0xffffff } )
	);
	scene.add( cube );

	scene.add( new THREE.HemisphereLight( 0xffffff, 0x444444, 2 ) );
	const light = new THREE.DirectionalLight( 0xffffff, 2 );
	light.position.set( 3, 5, 2 );
	scene.add( light );

	// splat
	const splatData = await new CompressedPLYLoader().loadAsync( '/scene.compressed.ply' );
	splats = new GaussianSplat( splatData, { autoSort: false } );
	splats.rotation.set( Math.PI, 0, 0 ); // 3DGS scenes are typically Y-down
	scene.add( splats );

	window.addEventListener( 'resize', onWindowResize );

}

function onWindowResize() {

	camera.aspect = window.innerWidth / window.innerHeight;
	camera.updateProjectionMatrix();

	renderer.setSize( window.innerWidth, window.innerHeight );

}

function animate() {

	controls.update();

	if ( splats !== undefined ) splats.updateSort( renderer, camera );

	renderer.render( scene, camera );

}
