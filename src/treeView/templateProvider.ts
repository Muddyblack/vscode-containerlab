import * as vscode from 'vscode';
import * as path from 'path';
import { TemplateManager, Template, NodeTemplate, StackTemplate, isNodeTemplate, isStackTemplate } from '../helpers/templateManager';

export class TemplateTreeItem extends vscode.TreeItem {
    constructor(
        public readonly label: string,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState,
        public readonly template?: Template,
        public readonly category?: 'node' | 'stack'
    ) {
        super(label, collapsibleState);
        
        if (this.template) {
            // This is a template item
            if (isNodeTemplate(this.template)) {
                this.contextValue = 'nodeTemplate';
                this.tooltip = `${this.template.description || ''}\nKind: ${this.template.kind}\nImage: ${this.template.image || 'default'}`;
                this.iconPath = new vscode.ThemeIcon('file-code');
            } else if (isStackTemplate(this.template)) {
                this.contextValue = 'stackTemplate';
                this.tooltip = this.template.description || `Stack with ${Object.keys(this.template.topology.nodes).length} nodes`;
                this.iconPath = new vscode.ThemeIcon('files');
            }
            
            // Enable drag and drop
            this.command = {
                command: 'containerlab.template.preview',
                title: 'Preview Template',
                arguments: [this.template]
            };
        } else if (this.category) {
            // This is a category item
            this.contextValue = 'templateCategory';
            this.iconPath = new vscode.ThemeIcon('folder');
        }
    }

    // For drag and drop support
    get resourceUri(): vscode.Uri {
        if (this.template) {
            return vscode.Uri.parse(`template://${this.template.id}`);
        }
        return vscode.Uri.parse(`template-category://${this.category}`);
    }
}

export class TemplateTreeDataProvider implements vscode.TreeDataProvider<TemplateTreeItem>, vscode.TreeDragAndDropController<TemplateTreeItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<TemplateTreeItem | undefined | null | void> = new vscode.EventEmitter<TemplateTreeItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<TemplateTreeItem | undefined | null | void> = this._onDidChangeTreeData.event;

    // Drag and drop mime type
    readonly dropMimeTypes = ['application/vnd.code.tree.containerlab-templates'];
    readonly dragMimeTypes = ['text/uri-list'];

    private templateManager: TemplateManager;

    constructor() {
        this.templateManager = TemplateManager.getInstance();
        this.initializeTemplates();
    }

    private async initializeTemplates() {
        await this.templateManager.initialize();
        await this.templateManager.createDefaultTemplates();
        this.refresh();
    }

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    async refreshTemplates(): Promise<void> {
        await this.templateManager.refresh();
        this.refresh();
    }

    getTreeItem(element: TemplateTreeItem): vscode.TreeItem {
        return element;
    }

    async getChildren(element?: TemplateTreeItem): Promise<TemplateTreeItem[]> {
        if (!element) {
            // Root level - show categories
            return [
                new TemplateTreeItem('Node Templates', vscode.TreeItemCollapsibleState.Expanded, undefined, 'node'),
                new TemplateTreeItem('Stack Templates', vscode.TreeItemCollapsibleState.Expanded, undefined, 'stack')
            ];
        } else if (element.category === 'node') {
            // Show node templates
            const nodeTemplates = this.templateManager.getNodeTemplates();
            return nodeTemplates.map(template => 
                new TemplateTreeItem(
                    template.name,
                    vscode.TreeItemCollapsibleState.None,
                    template
                )
            );
        } else if (element.category === 'stack') {
            // Show stack templates
            const stackTemplates = this.templateManager.getStackTemplates();
            return stackTemplates.map(template => 
                new TemplateTreeItem(
                    template.name,
                    vscode.TreeItemCollapsibleState.None,
                    template
                )
            );
        }

        return [];
    }

    // Drag and drop implementation
    public async handleDrag(source: readonly TemplateTreeItem[], dataTransfer: vscode.DataTransfer, token: vscode.CancellationToken): Promise<void> {
        const templates = source.filter(item => item.template).map(item => item.template!);
        if (templates.length > 0) {
            // Create a data object with template information
            const dragData = templates.map(template => ({
                type: isNodeTemplate(template) ? 'node' : 'stack',
                template: template
            }));
            
            dataTransfer.set('application/vnd.code.tree.containerlab-templates', 
                new vscode.DataTransferItem(JSON.stringify(dragData)));
        }
    }

    public async handleDrop(target: TemplateTreeItem | undefined, dataTransfer: vscode.DataTransfer, token: vscode.CancellationToken): Promise<void> {
        // Templates are dropped onto the TopoViewer canvas, not within this tree
        // This method is here for completeness but won't be used
    }
}

export function registerTemplateTreeView(context: vscode.ExtensionContext): TemplateTreeDataProvider {
    const provider = new TemplateTreeDataProvider();
    
    // Create tree view with drag and drop support
    const treeView = vscode.window.createTreeView('containerlabTemplates', {
        treeDataProvider: provider,
        showCollapseAll: true,
        canSelectMany: false,
        dragAndDropController: provider
    });

    // Register commands
    context.subscriptions.push(
        vscode.commands.registerCommand('containerlab.template.refresh', () => {
            provider.refreshTemplates();
        }),
        vscode.commands.registerCommand('containerlab.template.preview', (template: Template) => {
            // Show template details in output or preview
            const output = vscode.window.createOutputChannel('Containerlab Template Preview', { log: true });
            output.show();
            output.appendLine(`Template: ${template.name}`);
            output.appendLine(`ID: ${template.id}`);
            if (template.description) {
                output.appendLine(`Description: ${template.description}`);
            }
            output.appendLine('');
            
            if (isNodeTemplate(template)) {
                output.appendLine('Type: Node Template');
                output.appendLine(`Kind: ${template.kind}`);
                if (template.image) output.appendLine(`Image: ${template.image}`);
                if (template.type) output.appendLine(`Type: ${template.type}`);
                if (template.group) output.appendLine(`Group: ${template.group}`);
                if (template.topoViewerRole) output.appendLine(`Role: ${template.topoViewerRole}`);
            } else if (isStackTemplate(template)) {
                output.appendLine('Type: Stack Template');
                output.appendLine(`Nodes: ${Object.keys(template.topology.nodes).join(', ')}`);
                if (template.topology.links) {
                    output.appendLine(`Links: ${template.topology.links.length}`);
                }
            }
        }),
        vscode.commands.registerCommand('containerlab.template.create', async () => {
            // Quick pick to choose template type
            const templateType = await vscode.window.showQuickPick(
                ['Node Template', 'Stack Template'],
                { placeHolder: 'Select template type' }
            );
            
            if (!templateType) return;
            
            const name = await vscode.window.showInputBox({
                prompt: 'Enter template name',
                validateInput: (value) => {
                    if (!value || value.trim().length === 0) {
                        return 'Template name is required';
                    }
                    return undefined;
                }
            });
            
            if (!name) return;
            
            const description = await vscode.window.showInputBox({
                prompt: 'Enter template description (optional)'
            });
            
            try {
                if (templateType === 'Node Template') {
                    // Create node template
                    const kinds = ['nokia_srlinux', 'cisco_xrd', 'arista_ceos', 'juniper_vmx', 'linux', 'custom'];
                    const kind = await vscode.window.showQuickPick(kinds, {
                        placeHolder: 'Select node kind'
                    });
                    
                    if (!kind) return;
                    
                    await provider.templateManager.createNodeTemplate({
                        name,
                        description,
                        kind
                    });
                } else {
                    // Create stack template
                    await provider.templateManager.createStackTemplate({
                        name,
                        description,
                        topology: {
                            name: name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
                            nodes: {}
                        }
                    });
                }
                
                provider.refresh();
                vscode.window.showInformationMessage(`Template '${name}' created successfully`);
            } catch (error) {
                vscode.window.showErrorMessage(`Failed to create template: ${error}`);
            }
        }),
        vscode.commands.registerCommand('containerlab.template.delete', async (item: TemplateTreeItem) => {
            if (!item.template) return;
            
            const answer = await vscode.window.showWarningMessage(
                `Are you sure you want to delete template '${item.template.name}'?`,
                'Yes', 'No'
            );
            
            if (answer === 'Yes') {
                try {
                    await provider.templateManager.deleteTemplate(item.template.id);
                    provider.refresh();
                    vscode.window.showInformationMessage(`Template '${item.template.name}' deleted`);
                } catch (error) {
                    vscode.window.showErrorMessage(`Failed to delete template: ${error}`);
                }
            }
        }),
        vscode.commands.registerCommand('containerlab.template.edit', async (item: TemplateTreeItem) => {
            if (!item.template) return;
            
            // Open the template directory
            const templatePath = path.join(provider.templateManager.getTemplatesDirectory(), item.template.id, 'template.yaml');
            const doc = await vscode.workspace.openTextDocument(templatePath);
            await vscode.window.showTextDocument(doc);
        }),
        vscode.commands.registerCommand('containerlab.template.openFolder', () => {
            const templatesDir = provider.templateManager.getTemplatesDirectory();
            vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(templatesDir), true);
        }),
        treeView
    );

    return provider;
}