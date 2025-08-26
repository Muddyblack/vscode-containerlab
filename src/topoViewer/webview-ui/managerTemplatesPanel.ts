import cytoscape from 'cytoscape';
import { log } from '../logging/logger';

interface NodeTemplate {
    id: string;
    name: string;
    description?: string;
    kind: string;
    image?: string;
    type?: string;
    group?: string;
    topoViewerRole?: string;
    env?: Record<string, string>;
    cmd?: string;
    exec?: string[];
    binds?: string[];
    ports?: string[];
    labels?: Record<string, string>;
}

interface StackTemplate {
    id: string;
    name: string;
    description?: string;
    topology: {
        name: string;
        nodes: Record<string, any>;
        links?: Array<any>;
    };
}

type Template = NodeTemplate | StackTemplate;

export class ManagerTemplatesPanel {
    private cy: cytoscape.Core;
    private templates: Template[] = [];
    private panelVisible = false;

    constructor(cy: cytoscape.Core) {
        this.cy = cy;
        this.initializePanel();
        this.loadTemplates();
    }

    private async initializePanel(): Promise<void> {
        const panel = document.getElementById('panel-templates');
        if (!panel) {
            log.error('Templates panel not found in DOM');
            return;
        }

        // Setup close button
        const closeBtn = document.getElementById('panel-templates-close-button');
        if (closeBtn) {
            closeBtn.addEventListener('click', () => this.hidePanel());
        }

        // Setup search functionality
        const searchInput = document.getElementById('template-search') as HTMLInputElement;
        if (searchInput) {
            searchInput.addEventListener('input', (e) => {
                const query = (e.target as HTMLInputElement).value.toLowerCase();
                this.filterTemplates(query);
            });
        }

        // Setup category toggles
        const categoryToggles = document.querySelectorAll('.template-category-toggle');
        categoryToggles.forEach(toggle => {
            toggle.addEventListener('click', (e) => {
                const category = (e.target as Element).closest('.template-category');
                if (category) {
                    category.classList.toggle('collapsed');
                }
            });
        });

        // Setup drag and drop on the canvas
        this.setupCanvasDrop();
    }

    private async loadTemplates(): Promise<void> {
        try {
            // Request templates from the extension
            const result = await window.backendRequest('getTemplates', {});
            if (Array.isArray(result)) {
                this.templates = result;
                this.renderTemplates();
            }
        } catch (error) {
            log.error('Failed to load templates:', error);
            // Use some default templates for now
            this.templates = this.getDefaultTemplates();
            this.renderTemplates();
        }
    }

    private getDefaultTemplates(): Template[] {
        return [
            {
                id: 'srlinux',
                name: 'SR Linux',
                description: 'Nokia SR Linux router',
                kind: 'nokia_srlinux',
                image: 'ghcr.io/nokia/srlinux:latest',
                type: 'ixrd3',
                topoViewerRole: 'pe'
            },
            {
                id: 'ceos',
                name: 'Arista cEOS',
                description: 'Arista cEOS switch',
                kind: 'arista_ceos',
                image: 'ceos:latest',
                topoViewerRole: 'pe'
            },
            {
                id: 'linux-host',
                name: 'Linux Host',
                description: 'Alpine Linux host',
                kind: 'linux',
                image: 'alpine:latest',
                topoViewerRole: 'host'
            },
            {
                id: 'telemetry-stack',
                name: 'Telemetry Stack',
                description: 'Grafana, Prometheus, and Alloy',
                topology: {
                    name: 'telemetry',
                    nodes: {
                        grafana: {
                            kind: 'linux',
                            image: 'grafana/grafana:latest',
                            ports: ['3000:3000']
                        },
                        prometheus: {
                            kind: 'linux',
                            image: 'prom/prometheus:latest',
                            ports: ['9090:9090']
                        },
                        alloy: {
                            kind: 'linux',
                            image: 'grafana/alloy:latest'
                        }
                    },
                    links: [
                        { endpoints: ['grafana:eth1', 'prometheus:eth1'] },
                        { endpoints: ['prometheus:eth2', 'alloy:eth1'] }
                    ]
                }
            }
        ];
    }

    private renderTemplates(): void {
        const nodeTemplatesList = document.getElementById('node-templates-list');
        const stackTemplatesList = document.getElementById('stack-templates-list');
        const templateItemTemplate = document.getElementById('template-item-template') as HTMLTemplateElement;

        if (!nodeTemplatesList || !stackTemplatesList || !templateItemTemplate) {
            log.error('Template elements not found in DOM');
            return;
        }

        // Clear existing templates
        nodeTemplatesList.innerHTML = '';
        stackTemplatesList.innerHTML = '';

        // Render templates
        this.templates.forEach(template => {
            const isNodeTemplate = 'kind' in template;
            const targetList = isNodeTemplate ? nodeTemplatesList : stackTemplatesList;
            
            const templateElement = this.createTemplateElement(template, templateItemTemplate);
            targetList.appendChild(templateElement);
        });
    }

    private createTemplateElement(template: Template, templateItemTemplate: HTMLTemplateElement): HTMLElement {
        const clone = templateItemTemplate.content.cloneNode(true) as DocumentFragment;
        const element = clone.querySelector('.template-item') as HTMLElement;
        
        if (!element) return document.createElement('div');

        // Set template data
        element.dataset.templateId = template.id;
        element.dataset.templateType = 'kind' in template ? 'node' : 'stack';
        element.dataset.template = JSON.stringify(template);

        // Set name and description
        const nameEl = element.querySelector('.template-name');
        const descEl = element.querySelector('.template-description');
        const iconEl = element.querySelector('.template-icon');

        if (nameEl) nameEl.textContent = template.name;
        if (descEl) descEl.textContent = template.description || '';
        
        // Set icon based on type
        if (iconEl) {
            if ('kind' in template) {
                iconEl.className = 'template-icon mr-2 fas fa-server';
            } else {
                iconEl.className = 'template-icon mr-2 fas fa-layer-group';
            }
        }

        // Setup drag events
        element.addEventListener('dragstart', (e) => this.handleDragStart(e, template));
        element.addEventListener('dragend', (e) => this.handleDragEnd(e));

        return element;
    }

    private handleDragStart(e: DragEvent, template: Template): void {
        if (!e.dataTransfer) return;

        const element = e.target as HTMLElement;
        element.classList.add('dragging');
        
        e.dataTransfer.effectAllowed = 'copy';
        e.dataTransfer.setData('application/containerlab-template', JSON.stringify(template));
        
        // Set drag image
        const dragImage = element.cloneNode(true) as HTMLElement;
        dragImage.style.position = 'absolute';
        dragImage.style.top = '-1000px';
        document.body.appendChild(dragImage);
        e.dataTransfer.setDragImage(dragImage, e.offsetX, e.offsetY);
        setTimeout(() => document.body.removeChild(dragImage), 0);
    }

    private handleDragEnd(e: DragEvent): void {
        const element = e.target as HTMLElement;
        element.classList.remove('dragging');
    }

    private setupCanvasDrop(): void {
        const cyContainer = this.cy.container();
        if (!cyContainer) return;

        cyContainer.addEventListener('dragover', (e) => {
            e.preventDefault();
            e.dataTransfer!.dropEffect = 'copy';
        });

        cyContainer.addEventListener('drop', (e) => {
            e.preventDefault();
            
            const templateData = e.dataTransfer?.getData('application/containerlab-template');
            if (!templateData) return;

            try {
                const template = JSON.parse(templateData) as Template;
                const position = this.getDropPosition(e);
                
                if ('kind' in template) {
                    this.addNodeFromTemplate(template as NodeTemplate, position);
                } else {
                    this.addStackFromTemplate(template as StackTemplate, position);
                }
            } catch (error) {
                log.error('Failed to handle template drop:', error);
            }
        });
    }

    private getDropPosition(e: DragEvent): cytoscape.Position {
        const cyContainer = this.cy.container();
        const rect = cyContainer!.getBoundingClientRect();
        
        // Get the position relative to the canvas
        const canvasX = e.clientX - rect.left;
        const canvasY = e.clientY - rect.top;
        
        // Convert to cytoscape coordinates
        const pan = this.cy.pan();
        const zoom = this.cy.zoom();
        
        return {
            x: (canvasX - pan.x) / zoom,
            y: (canvasY - pan.y) / zoom
        };
    }

    private addNodeFromTemplate(template: NodeTemplate, position: cytoscape.Position): void {
        // Generate unique node ID
        const existingNodes = this.cy.nodes().map(n => n.id());
        let nodeId = template.name.toLowerCase().replace(/[^a-z0-9]/g, '');
        let counter = 1;
        while (existingNodes.includes(nodeId)) {
            nodeId = `${template.name.toLowerCase().replace(/[^a-z0-9]/g, '')}${counter}`;
            counter++;
        }

        // Create node data
        const nodeData: any = {
            id: nodeId,
            name: nodeId,
            extraData: {
                name: nodeId,
                kind: template.kind,
                image: template.image || '',
                type: template.type || '',
                group: template.group || '',
                topoViewerRole: template.topoViewerRole || 'pe'
            }
        };

        // Add additional properties if present
        if (template.env) nodeData.extraData.env = template.env;
        if (template.cmd) nodeData.extraData.cmd = template.cmd;
        if (template.exec) nodeData.extraData.exec = template.exec;
        if (template.binds) nodeData.extraData.binds = template.binds;
        if (template.ports) nodeData.extraData.ports = template.ports;
        if (template.labels) nodeData.extraData.labels = template.labels;

        // Add node to graph
        this.cy.add({
            group: 'nodes',
            data: nodeData,
            position: position
        });

        log.info(`Added node '${nodeId}' from template '${template.name}'`);
    }

    private addStackFromTemplate(template: StackTemplate, position: cytoscape.Position): void {
        const basePosition = position;
        const nodeSpacing = 150;
        const nodesPerRow = 3;
        
        // Keep track of created nodes for linking
        const createdNodes: Record<string, string> = {};
        let nodeIndex = 0;

        // Add nodes
        Object.entries(template.topology.nodes).forEach(([nodeName, nodeConfig]) => {
            const row = Math.floor(nodeIndex / nodesPerRow);
            const col = nodeIndex % nodesPerRow;
            
            const nodePosition = {
                x: basePosition.x + col * nodeSpacing,
                y: basePosition.y + row * nodeSpacing
            };

            // Generate unique ID
            const existingNodes = this.cy.nodes().map(n => n.id());
            let nodeId = nodeName;
            let counter = 1;
            while (existingNodes.includes(nodeId)) {
                nodeId = `${nodeName}${counter}`;
                counter++;
            }

            createdNodes[nodeName] = nodeId;

            // Create node
            const nodeData: any = {
                id: nodeId,
                name: nodeId,
                extraData: {
                    name: nodeId,
                    ...nodeConfig
                }
            };

            this.cy.add({
                group: 'nodes',
                data: nodeData,
                position: nodePosition
            });

            nodeIndex++;
        });

        // Add links
        if (template.topology.links) {
            template.topology.links.forEach((link, index) => {
                if (link.endpoints && link.endpoints.length === 2) {
                    const [sourceEndpoint, targetEndpoint] = link.endpoints;
                    const [sourceName, sourceIface] = sourceEndpoint.split(':');
                    const [targetName, targetIface] = targetEndpoint.split(':');

                    const sourceId = createdNodes[sourceName];
                    const targetId = createdNodes[targetName];

                    if (sourceId && targetId) {
                        this.cy.add({
                            group: 'edges',
                            data: {
                                id: `${sourceId}-${targetId}-${index}`,
                                source: sourceId,
                                target: targetId,
                                sourceName: sourceId,
                                targetName: targetId,
                                sourceEndpoint: sourceIface,
                                targetEndpoint: targetIface
                            }
                        });
                    }
                }
            });
        }

        log.info(`Added stack '${template.name}' with ${Object.keys(createdNodes).length} nodes`);
    }

    private filterTemplates(query: string): void {
        const templateItems = document.querySelectorAll('.template-item');
        
        templateItems.forEach(item => {
            const name = item.querySelector('.template-name')?.textContent?.toLowerCase() || '';
            const description = item.querySelector('.template-description')?.textContent?.toLowerCase() || '';
            
            if (name.includes(query) || description.includes(query)) {
                (item as HTMLElement).style.display = '';
            } else {
                (item as HTMLElement).style.display = 'none';
            }
        });
    }

    public showPanel(): void {
        const panel = document.getElementById('panel-templates');
        if (panel) {
            panel.style.display = 'block';
            this.panelVisible = true;
            this.loadTemplates(); // Refresh templates when showing
        }
    }

    public hidePanel(): void {
        const panel = document.getElementById('panel-templates');
        if (panel) {
            panel.style.display = 'none';
            this.panelVisible = false;
        }
    }

    public togglePanel(): void {
        if (this.panelVisible) {
            this.hidePanel();
        } else {
            this.showPanel();
        }
    }

    public isVisible(): boolean {
        return this.panelVisible;
    }
}