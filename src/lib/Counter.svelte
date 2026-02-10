<script lang="ts">
  export let heading = 'Controls'
  export let controls: Array<{ label: string; description: string }> = []
</script>

<section class="legend" aria-live="polite">
  <h2>{heading}</h2>
  <ul>
    {#each controls as control}
      <li>
        <span class="key-chip">{control.label}</span>
        <span class="description">{control.description}</span>
      </li>
    {/each}
  </ul>
</section>

<style>
  .legend {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    background: rgba(255, 255, 255, 0.03);
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 1rem;
    padding: 1.25rem;
  }

  h2 {
    margin: 0;
    font-size: 1rem;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: #9fb7ff;
  }

  ul {
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    margin: 0;
    padding: 0;
  }

  li {
    display: grid;
    grid-template-columns: max-content 1fr;
    align-items: center;
    gap: 0.75rem;
  }

  .key-chip {
    font-weight: 600;
    font-size: 0.85rem;
    padding: 0.2rem 0.75rem;
    border-radius: 999px;
    border: 1px solid rgba(255, 255, 255, 0.2);
    background: rgba(255, 255, 255, 0.08);
  }

  .description {
    color: rgba(255, 255, 255, 0.85);
    font-size: 0.95rem;
  }

  @media (max-width: 640px) {
    li {
      grid-template-columns: 1fr;
      gap: 0.35rem;
    }
    .key-chip {
      width: fit-content;
    }
  }
</style>
