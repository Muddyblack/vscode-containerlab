import * as vscode from 'vscode';
import { DockerImageProvider, ContainerlabImage } from '../helpers/dockerImageProvider';

export class DockerImagesTreeItem extends vscode.TreeItem {
    constructor(
        public readonly label: string,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState,
        public readonly image?: ContainerlabImage,
        public readonly kind?: string
    ) {
        super(label, collapsibleState);
        
        if (this.image) {
            // This is an image item
            this.contextValue = 'dockerImage';
            this.tooltip = `${this.image.repository}:${this.image.tag}\nSize: ${this.image.size}\nCreated: ${this.image.created}`;
            this.iconPath = new vscode.ThemeIcon('package');
            
            // Add description showing the tag
            this.description = this.image.tag;
            
            // Store the full image reference for easy access
            this.command = {
                command: 'containerlab.dockerImages.copyImage',
                title: 'Copy Image',
                arguments: [`${this.image.repository}:${this.image.tag}`]
            };
        } else if (this.kind) {
            // This is a kind category item
            this.contextValue = 'dockerImageKind';
            this.iconPath = new vscode.ThemeIcon('folder');
        }
    }
}

export class DockerImagesTreeDataProvider implements vscode.TreeDataProvider<DockerImagesTreeItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<DockerImagesTreeItem | undefined | null | void> = new vscode.EventEmitter<DockerImagesTreeItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<DockerImagesTreeItem | undefined | null | void> = this._onDidChangeTreeData.event;

    private dockerImageProvider: DockerImageProvider;
    private filterText: string = '';

    constructor() {
        this.dockerImageProvider = DockerImageProvider.getInstance();
    }

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    async refreshImages(): Promise<void> {
        await this.dockerImageProvider.getImages(true);
        this.refresh();
    }

    setFilter(filter: string): void {
        this.filterText = filter.toLowerCase();
        this.refresh();
    }

    getTreeItem(element: DockerImagesTreeItem): vscode.TreeItem {
        return element;
    }

    async getChildren(element?: DockerImagesTreeItem): Promise<DockerImagesTreeItem[]> {
        if (!element) {
            // Root level - show kinds
            const images = await this.dockerImageProvider.getImages();
            
            // Apply filter if set
            const filteredImages = this.filterText 
                ? images.filter(img => 
                    img.repository.toLowerCase().includes(this.filterText) ||
                    img.tag.toLowerCase().includes(this.filterText) ||
                    img.kind.toLowerCase().includes(this.filterText)
                  )
                : images;

            // Group by kind
            const kindGroups = new Map<string, ContainerlabImage[]>();
            filteredImages.forEach(img => {
                if (!kindGroups.has(img.kind)) {
                    kindGroups.set(img.kind, []);
                }
                kindGroups.get(img.kind)!.push(img);
            });

            // Create tree items for each kind
            const items: DockerImagesTreeItem[] = [];
            const sortedKinds = Array.from(kindGroups.keys()).sort();
            
            for (const kind of sortedKinds) {
                const images = kindGroups.get(kind)!;
                const label = `${kind} (${images.length})`;
                items.push(new DockerImagesTreeItem(
                    label,
                    vscode.TreeItemCollapsibleState.Collapsed,
                    undefined,
                    kind
                ));
            }

            return items;
        } else if (element.kind) {
            // Show images for a specific kind
            const images = await this.dockerImageProvider.getImages();
            const kindImages = images
                .filter(img => img.kind === element.kind)
                .filter(img => 
                    !this.filterText ||
                    img.repository.toLowerCase().includes(this.filterText) ||
                    img.tag.toLowerCase().includes(this.filterText)
                )
                .sort((a, b) => {
                    // Sort official images first, then alphabetically
                    if (a.isOfficial !== b.isOfficial) {
                        return a.isOfficial ? -1 : 1;
                    }
                    return a.repository.localeCompare(b.repository);
                });

            return kindImages.map(img => new DockerImagesTreeItem(
                img.repository,
                vscode.TreeItemCollapsibleState.None,
                img
            ));
        }

        return [];
    }
}

export function registerDockerImagesTreeView(context: vscode.ExtensionContext): DockerImagesTreeDataProvider {
    const provider = new DockerImagesTreeDataProvider();
    
    // Register tree view
    const treeView = vscode.window.createTreeView('dockerImages', {
        treeDataProvider: provider,
        showCollapseAll: true
    });

    // Register commands
    context.subscriptions.push(
        vscode.commands.registerCommand('containerlab.dockerImages.refresh', () => {
            provider.refreshImages();
        }),
        vscode.commands.registerCommand('containerlab.dockerImages.copyImage', (imageRef: string) => {
            vscode.env.clipboard.writeText(imageRef);
            vscode.window.showInformationMessage(`Copied ${imageRef} to clipboard`);
        }),
        treeView
    );

    // Add search/filter input
    const searchInput = vscode.window.createQuickPick();
    searchInput.placeholder = 'Filter images...';
    searchInput.onDidChangeValue(value => {
        provider.setFilter(value);
    });

    context.subscriptions.push(
        vscode.commands.registerCommand('containerlab.dockerImages.search', () => {
            searchInput.show();
        })
    );

    return provider;
}