import * as vscode from 'vscode';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import * as yaml from 'yaml';

export interface NodeTemplate {
    id: string;
    name: string;
    description?: string;
    kind: string;
    image?: string;
    type?: string;
    group?: string;
    topoViewerRole?: string;
    // Additional node properties
    env?: Record<string, string>;
    cmd?: string;
    exec?: string[];
    binds?: string[];
    ports?: string[];
    labels?: Record<string, string>;
    // Startup config path (relative to template)
    startupConfig?: string;
}

export interface StackTemplate {
    id: string;
    name: string;
    description?: string;
    // Topology definition (similar to .clab.yml)
    topology: {
        name: string;
        nodes: Record<string, any>;
        links?: Array<any>;
    };
    // Optional configuration files (relative paths)
    configs?: Record<string, string>;
}

export type Template = NodeTemplate | StackTemplate;

export function isNodeTemplate(template: Template): template is NodeTemplate {
    return 'kind' in template;
}

export function isStackTemplate(template: Template): template is StackTemplate {
    return 'topology' in template;
}

export class TemplateManager {
    private static instance: TemplateManager;
    private templatesDir: string;
    private templates: Map<string, Template> = new Map();

    private constructor() {
        // Default to ~/.containerlab/templates
        this.templatesDir = path.join(os.homedir(), '.containerlab', 'templates');
    }

    public static getInstance(): TemplateManager {
        if (!TemplateManager.instance) {
            TemplateManager.instance = new TemplateManager();
        }
        return TemplateManager.instance;
    }

    /**
     * Initialize the template manager and ensure templates directory exists
     */
    public async initialize(): Promise<void> {
        try {
            await fs.mkdir(this.templatesDir, { recursive: true });
            await this.loadTemplates();
        } catch (error) {
            console.error('Failed to initialize template manager:', error);
        }
    }

    /**
     * Load all templates from the templates directory
     */
    private async loadTemplates(): Promise<void> {
        this.templates.clear();

        try {
            const entries = await fs.readdir(this.templatesDir, { withFileTypes: true });
            
            for (const entry of entries) {
                if (entry.isDirectory()) {
                    const templatePath = path.join(this.templatesDir, entry.name);
                    try {
                        const template = await this.loadTemplate(templatePath);
                        if (template) {
                            this.templates.set(template.id, template);
                        }
                    } catch (error) {
                        console.error(`Failed to load template from ${templatePath}:`, error);
                    }
                }
            }
        } catch (error) {
            console.error('Failed to load templates:', error);
        }
    }

    /**
     * Load a single template from a directory
     */
    private async loadTemplate(templatePath: string): Promise<Template | null> {
        const templateFile = path.join(templatePath, 'template.yaml');
        
        try {
            const content = await fs.readFile(templateFile, 'utf-8');
            const data = yaml.parse(content);
            
            // Add the template ID based on directory name
            data.id = path.basename(templatePath);
            
            return data as Template;
        } catch (error) {
            console.error(`Failed to load template from ${templateFile}:`, error);
            return null;
        }
    }

    /**
     * Get all templates
     */
    public getTemplates(): Template[] {
        return Array.from(this.templates.values());
    }

    /**
     * Get templates by type
     */
    public getNodeTemplates(): NodeTemplate[] {
        return this.getTemplates().filter(isNodeTemplate);
    }

    public getStackTemplates(): StackTemplate[] {
        return this.getTemplates().filter(isStackTemplate);
    }

    /**
     * Get a template by ID
     */
    public getTemplate(id: string): Template | undefined {
        return this.templates.get(id);
    }

    /**
     * Create a new node template
     */
    public async createNodeTemplate(template: Omit<NodeTemplate, 'id'>): Promise<NodeTemplate> {
        const id = this.generateTemplateId(template.name);
        const fullTemplate: NodeTemplate = { ...template, id };
        
        await this.saveTemplate(fullTemplate);
        this.templates.set(id, fullTemplate);
        
        return fullTemplate;
    }

    /**
     * Create a new stack template
     */
    public async createStackTemplate(template: Omit<StackTemplate, 'id'>): Promise<StackTemplate> {
        const id = this.generateTemplateId(template.name);
        const fullTemplate: StackTemplate = { ...template, id };
        
        await this.saveTemplate(fullTemplate);
        this.templates.set(id, fullTemplate);
        
        return fullTemplate;
    }

    /**
     * Update an existing template
     */
    public async updateTemplate(id: string, updates: Partial<Template>): Promise<void> {
        const template = this.templates.get(id);
        if (!template) {
            throw new Error(`Template ${id} not found`);
        }

        const updatedTemplate = { ...template, ...updates };
        await this.saveTemplate(updatedTemplate);
        this.templates.set(id, updatedTemplate);
    }

    /**
     * Delete a template
     */
    public async deleteTemplate(id: string): Promise<void> {
        const templatePath = path.join(this.templatesDir, id);
        
        try {
            await fs.rm(templatePath, { recursive: true, force: true });
            this.templates.delete(id);
        } catch (error) {
            throw new Error(`Failed to delete template ${id}: ${error}`);
        }
    }

    /**
     * Save a template to disk
     */
    private async saveTemplate(template: Template): Promise<void> {
        const templatePath = path.join(this.templatesDir, template.id);
        const templateFile = path.join(templatePath, 'template.yaml');
        
        // Create template directory
        await fs.mkdir(templatePath, { recursive: true });
        
        // Remove id from the saved data (it's derived from directory name)
        const { id, ...templateData } = template;
        
        // Save template metadata
        const yamlContent = yaml.stringify(templateData);
        await fs.writeFile(templateFile, yamlContent, 'utf-8');
        
        // If it's a node template with startup config, create a default one
        if (isNodeTemplate(template) && template.startupConfig) {
            const configPath = path.join(templatePath, template.startupConfig);
            try {
                await fs.access(configPath);
            } catch {
                // File doesn't exist, create a default
                await fs.writeFile(configPath, '# Startup configuration\n', 'utf-8');
            }
        }
        
        // If it's a stack template with configs, create them
        if (isStackTemplate(template) && template.configs) {
            for (const [configName, configContent] of Object.entries(template.configs)) {
                const configPath = path.join(templatePath, configName);
                await fs.writeFile(configPath, configContent, 'utf-8');
            }
        }
    }

    /**
     * Generate a unique template ID from name
     */
    private generateTemplateId(name: string): string {
        const baseId = name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
        let id = baseId;
        let counter = 1;
        
        while (this.templates.has(id)) {
            id = `${baseId}-${counter}`;
            counter++;
        }
        
        return id;
    }

    /**
     * Export a template as a standalone directory
     */
    public async exportTemplate(id: string, targetPath: string): Promise<void> {
        const templatePath = path.join(this.templatesDir, id);
        
        try {
            await fs.cp(templatePath, targetPath, { recursive: true });
        } catch (error) {
            throw new Error(`Failed to export template ${id}: ${error}`);
        }
    }

    /**
     * Import a template from a directory
     */
    public async importTemplate(sourcePath: string, name?: string): Promise<Template> {
        const templateFile = path.join(sourcePath, 'template.yaml');
        
        try {
            const content = await fs.readFile(templateFile, 'utf-8');
            const data = yaml.parse(content) as Template;
            
            // Override name if provided
            if (name) {
                data.name = name;
            }
            
            // Generate new ID
            const id = this.generateTemplateId(data.name);
            const targetPath = path.join(this.templatesDir, id);
            
            // Copy the template directory
            await fs.cp(sourcePath, targetPath, { recursive: true });
            
            // Update the template with new ID
            const template = { ...data, id };
            await this.saveTemplate(template);
            
            this.templates.set(id, template);
            return template;
        } catch (error) {
            throw new Error(`Failed to import template from ${sourcePath}: ${error}`);
        }
    }

    /**
     * Create default templates if none exist
     */
    public async createDefaultTemplates(): Promise<void> {
        if (this.templates.size > 0) {
            return; // Already have templates
        }

        // Create some default templates
        const defaultTemplates: Array<Omit<NodeTemplate | StackTemplate, 'id'>> = [
            {
                name: 'SR Linux',
                description: 'Nokia SR Linux router with basic configuration',
                kind: 'nokia_srlinux',
                image: 'ghcr.io/nokia/srlinux:latest',
                type: 'ixrd3',
                topoViewerRole: 'pe'
            },
            {
                name: 'Arista cEOS',
                description: 'Arista cEOS switch',
                kind: 'arista_ceos',
                image: 'ceos:latest',
                topoViewerRole: 'pe'
            },
            {
                name: 'Linux Host',
                description: 'Alpine Linux host for testing',
                kind: 'linux',
                image: 'alpine:latest',
                topoViewerRole: 'host'
            },
            {
                name: 'Telemetry Stack',
                description: 'Complete telemetry stack with Grafana, Prometheus, and Alloy',
                topology: {
                    name: 'telemetry-stack',
                    nodes: {
                        grafana: {
                            kind: 'linux',
                            image: 'grafana/grafana:latest',
                            ports: ['3000:3000'],
                            env: {
                                GF_SECURITY_ADMIN_PASSWORD: 'admin'
                            }
                        },
                        prometheus: {
                            kind: 'linux',
                            image: 'prom/prometheus:latest',
                            ports: ['9090:9090'],
                            binds: ['./prometheus.yml:/etc/prometheus/prometheus.yml:ro']
                        },
                        alloy: {
                            kind: 'linux',
                            image: 'grafana/alloy:latest',
                            binds: ['./alloy.river:/etc/alloy/config.river:ro']
                        }
                    },
                    links: [
                        { endpoints: ['grafana:eth1', 'prometheus:eth1'] },
                        { endpoints: ['prometheus:eth2', 'alloy:eth1'] }
                    ]
                },
                configs: {
                    'prometheus.yml': `global:
  scrape_interval: 15s

scrape_configs:
  - job_name: 'prometheus'
    static_configs:
      - targets: ['localhost:9090']
`,
                    'alloy.river': `// Basic Alloy configuration
`
                }
            }
        ];

        for (const templateData of defaultTemplates) {
            if ('kind' in templateData) {
                await this.createNodeTemplate(templateData as Omit<NodeTemplate, 'id'>);
            } else {
                await this.createStackTemplate(templateData as Omit<StackTemplate, 'id'>);
            }
        }
    }

    /**
     * Get the templates directory path
     */
    public getTemplatesDirectory(): string {
        return this.templatesDir;
    }

    /**
     * Refresh templates from disk
     */
    public async refresh(): Promise<void> {
        await this.loadTemplates();
    }
}