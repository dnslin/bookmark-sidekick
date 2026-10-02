import React from 'react';

export function createComponentHarness() {
  const slots = [];
  let index = 0;
  let changed = false;
  let effects = [];
  let tree;
  const same = (previous, next) => previous && next && previous.length === next.length && previous.every((value, i) => Object.is(value, next[i]));
  const hooks = {
    ...React,
    useState(initial) {
      const slot = index++;
      if (!Object.hasOwn(slots, slot)) slots[slot] = typeof initial === 'function' ? initial() : initial;
      return [slots[slot], value => {
        const next = typeof value === 'function' ? value(slots[slot]) : value;
        if (!Object.is(slots[slot], next)) changed = true;
        slots[slot] = next;
      }];
    },
    useRef(initial) {
      const slot = index++;
      if (!Object.hasOwn(slots, slot)) slots[slot] = { current: initial };
      return slots[slot];
    },
    useMemo(factory, dependencies) {
      const slot = index++;
      if (!same(slots[slot]?.dependencies, dependencies)) slots[slot] = { dependencies, value: factory() };
      return slots[slot].value;
    },
    useEffect(effect, dependencies) {
      const slot = index++;
      if (!same(slots[slot]?.dependencies, dependencies)) {
        effects.push(() => {
          slots[slot]?.cleanup?.();
          slots[slot] = { dependencies, cleanup: effect() };
        });
      }
    },
  };
  function render(component, props) {
    do {
      changed = false;
      index = 0;
      effects = [];
      tree = component(props);
      effects.forEach(effect => effect());
    } while (changed);
    return tree;
  }
  function nodes(predicate) {
    const matches = [];
    const visit = node => {
      if (Array.isArray(node)) node.forEach(visit);
      else if (React.isValidElement(node)) {
        if (predicate(node)) matches.push(node);
        visit(node.props.children);
      }
    };
    visit(tree);
    return matches;
  }
  return { hooks, render, nodes, find: predicate => nodes(predicate)[0], unmount: () => slots.forEach(slot => slot?.cleanup?.()) };
}

export const settle = () => new Promise(resolve => setImmediate(resolve));
