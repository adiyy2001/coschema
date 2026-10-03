import { connect, createNode, type CommandContext } from '@coschema/model';
import type { DocumentSeed } from './document-session';

export const starterDiagram: DocumentSeed = (context: CommandContext) => {
  context.doc.transact(() => {
    createNode(context, { id: 'intake', type: 'rounded', pos: [80, 168], label: 'Water intake' });
    createNode(context, { id: 'pump-a', type: 'rect', pos: [328, 72], label: 'Pump A' });
    createNode(context, { id: 'pump-b', type: 'rect', pos: [328, 264], label: 'Pump B' });
    createNode(context, {
      id: 'check',
      type: 'diamond',
      pos: [568, 144],
      size: [160, 96],
      label: 'Pressure?',
    });
    createNode(context, {
      id: 'tank',
      type: 'ellipse',
      pos: [816, 148],
      size: [152, 88],
      label: 'Storage tank',
    });
    createNode(context, { id: 'alarm', type: 'rect', pos: [576, 344], label: 'Alarm' });
    createNode(context, { id: 'outlet', type: 'rounded', pos: [832, 344], label: 'Outlet valve' });
    const link = (
      id: string,
      from: string,
      to: string,
      sourcePort: 'e' | 's',
      targetPort: 'w' | 'n',
    ) => {
      connect(context, { id, source: from, target: to, sourcePort, targetPort });
    };
    link('e1', 'intake', 'pump-a', 'e', 'w');
    link('e2', 'intake', 'pump-b', 'e', 'w');
    link('e3', 'pump-a', 'check', 'e', 'w');
    link('e4', 'pump-b', 'check', 'e', 'w');
    link('e5', 'check', 'tank', 'e', 'w');
    link('e6', 'check', 'alarm', 's', 'n');
    link('e7', 'tank', 'outlet', 's', 'n');
  }, context.origin);
};
