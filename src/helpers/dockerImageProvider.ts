import * as vscode from 'vscode';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export interface DockerImage {
    repository: string;
    tag: string;
    id: string;
    size: string;
    created: string;
}

export interface ContainerlabImage extends DockerImage {
    kind: string;
    isOfficial: boolean;
}

export class DockerImageProvider {
    private static instance: DockerImageProvider;
    private images: ContainerlabImage[] = [];
    private lastRefresh: number = 0;
    private refreshInterval: number = 60000; // 1 minute

      // Known containerlab image patterns with detailed patterns
  private readonly knownImages = {
    'nokia_srlinux': ['ghcr.io/nokia/srlinux', 'srlinux', 'nokia/srlinux'],
    'nokia_sros': ['vr-sros', 'nokia/sros', 'vrnetlab/vr-sros'],
    'nokia_srsim': ['ghcr.io/nokia/srsim', 'srsim', 'nokia/srsim'],
    'cisco_xrd': ['ios-xr', 'xrd', 'cisco/xrd', 'cisco-xrd'],
    'cisco_xrv': ['xrv', 'vr-xrv', 'vrnetlab/vr-xrv'],
    'cisco_xrv9k': ['xrv9k', 'vr-xrv9k', 'vrnetlab/vr-xrv9k'],
    'cisco_iosxr': ['iosxr', 'cisco/iosxr'],
    'cisco_csr1000v': ['csr1000v', 'vr-csr', 'vrnetlab/vr-csr'],
    'cisco_c8000v': ['c8000v', 'cisco/c8000v'],
    'cisco_cat9kv': ['cat9kv', 'cisco/cat9kv'],
    'arista_ceos': ['ceos', 'arista/ceos', 'ceosimage', 'arista/ceosimage'],
    'arista_veos': ['veos', 'arista/veos', 'vrnetlab/vr-veos'],
    'juniper_vmx': ['vmx', 'juniper/vmx', 'vrnetlab/vr-vmx'],
    'juniper_vqfx': ['vqfx', 'juniper/vqfx', 'vrnetlab/vr-vqfx'],
    'juniper_vjunos': ['vjunos-switch', 'juniper/vjunos', 'vjunos-router'],
    'cumulus_cvx': ['cumulus-vx', 'cumulusnetworks/cumulus-vx'],
    'sonic': ['docker-sonic-p4', 'docker-sonic-vs', 'azure/sonic'],
    'keysight_ixia': ['ixia', 'keysight/ixia-c'],
    'fortinet_fortigate': ['fortigate', 'fortinet/fortigate'],
    'paloalto_panos': ['panos', 'paloaltonetworks/panos'],
    'checkpoint_cloudguard': ['cloudguard', 'checkpoint/cloudguard'],
    'vyos': ['vyos/vyos', 'vyos/vyos-build'],
    'mikrotik_ros': ['mikrotik', 'vrnetlab/vr-routeros'],
    'openbsd': ['openbsd', 'vrnetlab/vr-openbsd'],
    'linux': ['alpine', 'ubuntu', 'debian', 'centos', 'fedora', 'rocky', 'alma'],
    'k8s_kind': ['kindest/node'],
    'frr': ['frrouting/frr', 'frr'],
    'gobgp': ['gobgp', 'osrg/gobgp'],
    'bird': ['bird', 'osrg/bird'],
    'quagga': ['quagga', 'osrg/quagga'],
    'telemetry': ['grafana/grafana', 'prometheus', 'telegraf', 'influxdb', 'alloy', 'otel']
  };

  // Patterns to exclude (like hello-world)
  private readonly excludePatterns = [
    'hello-world',
    'test',
    'example',
    'demo',
    'tutorial',
    'sample',
    'tmp',
    'temp'
  ];

    private constructor() {}

    public static getInstance(): DockerImageProvider {
        if (!DockerImageProvider.instance) {
            DockerImageProvider.instance = new DockerImageProvider();
        }
        return DockerImageProvider.instance;
    }

    public async getImages(forceRefresh: boolean = false): Promise<ContainerlabImage[]> {
        const now = Date.now();
        if (!forceRefresh && this.images.length > 0 && (now - this.lastRefresh) < this.refreshInterval) {
            return this.images;
        }

        try {
            await this.refreshImages();
            this.lastRefresh = now;
        } catch (error) {
            console.error('Failed to refresh Docker images:', error);
        }

        return this.images;
    }

    private async refreshImages(): Promise<void> {
        try {
            // Get all Docker images
            const { stdout } = await execAsync('docker images --format "{{.Repository}}|{{.Tag}}|{{.ID}}|{{.Size}}|{{.CreatedSince}}"');
            
            const lines = stdout.trim().split('\n').filter(line => line.length > 0);
            const allImages: DockerImage[] = lines.map(line => {
                const [repository, tag, id, size, created] = line.split('|');
                return { repository, tag, id, size, created };
            });

            // Filter and categorize containerlab-relevant images
            this.images = allImages
                .filter(img => this.isContainerlabImage(img))
                .map(img => this.categorizeImage(img));

        } catch (error) {
            console.error('Error fetching Docker images:', error);
            throw error;
        }
    }

    private isContainerlabImage(image: DockerImage): boolean {
        const fullName = `${image.repository}:${image.tag}`.toLowerCase();
        
        // Check if it matches any exclude pattern
        for (const exclude of this.excludePatterns) {
            if (fullName.includes(exclude)) {
                return false;
            }
        }

        // Check if it matches any known containerlab image pattern
        for (const patterns of Object.values(this.knownImages)) {
            for (const pattern of patterns) {
                if (fullName.includes(pattern.toLowerCase())) {
                    return true;
                }
            }
        }

        // Also include images that have 'clab' or 'containerlab' in their name
        if (fullName.includes('clab') || fullName.includes('containerlab')) {
            return true;
        }

        return false;
    }

    private categorizeImage(image: DockerImage): ContainerlabImage {
        const fullName = `${image.repository}:${image.tag}`.toLowerCase();
        
        // Find the kind based on known patterns
        let kind = 'custom';
        let isOfficial = false;

        for (const [kindName, patterns] of Object.entries(this.knownImages)) {
            for (const pattern of patterns) {
                if (fullName.includes(pattern.toLowerCase())) {
                    kind = kindName;
                    // Check if it's from an official repository
                    isOfficial = fullName.includes('ghcr.io') || 
                                fullName.includes('docker.io') ||
                                fullName.includes('quay.io') ||
                                !fullName.includes('/'); // Official Docker Hub images don't have a slash
                    break;
                }
            }
            if (kind !== 'custom') break;
        }

        return {
            ...image,
            kind,
            isOfficial
        };
    }

    public getImagesByKind(kind: string): ContainerlabImage[] {
        return this.images.filter(img => img.kind === kind);
    }

    public getUniqueKinds(): string[] {
        const kinds = new Set(this.images.map(img => img.kind));
        return Array.from(kinds).sort();
    }

    public searchImages(query: string): ContainerlabImage[] {
        const lowerQuery = query.toLowerCase();
        return this.images.filter(img => 
            img.repository.toLowerCase().includes(lowerQuery) ||
            img.tag.toLowerCase().includes(lowerQuery) ||
            img.kind.toLowerCase().includes(lowerQuery)
        );
    }

    /**
     * Get all available images for a specific kind, sorted by relevance
     */
    public getAvailableImagesForKind(kind: string): string[] {
        const kindImages = this.images.filter(img => img.kind === kind);
        
        // Sort by official status and name
        kindImages.sort((a, b) => {
            if (a.isOfficial !== b.isOfficial) {
                return a.isOfficial ? -1 : 1;
            }
            // Sort 'latest' tags first
            if (a.tag === 'latest' && b.tag !== 'latest') return -1;
            if (a.tag !== 'latest' && b.tag === 'latest') return 1;
            
            // Then by repository name
            const repoCompare = a.repository.localeCompare(b.repository);
            if (repoCompare !== 0) return repoCompare;
            
            // Finally by tag (version)
            return b.tag.localeCompare(a.tag); // Reverse for newest first
        });

        // Return unique image references
        const imageRefs = new Set<string>();
        kindImages.forEach(img => {
            imageRefs.add(`${img.repository}:${img.tag}`);
        });

        return Array.from(imageRefs);
    }

    /**
     * Get all available images across all kinds (for searching)
     */
    public getAllAvailableImages(): string[] {
        const imageRefs = new Set<string>();
        this.images.forEach(img => {
            imageRefs.add(`${img.repository}:${img.tag}`);
        });
        return Array.from(imageRefs).sort();
    }
}