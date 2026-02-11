<script lang="ts">
	import ControlsLegend from '../Counter.svelte'

	export let keyboardControls: Array<{ label: string; description: string }>
	export let mouseControls: Array<{ label: string; description: string }>
</script>

<section class="controls-panel">
	<h2>Controls</h2>
	<div class="controls-grid">
		<ControlsLegend title="Keyboard" controls={keyboardControls} />
		<ControlsLegend title="Mouse" controls={mouseControls} />
	</div>
</section>
