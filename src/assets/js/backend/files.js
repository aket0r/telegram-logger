class CreateAsset {
    execute(asset) {
        if (!asset) return;

        return this.create(asset.data);
    }

    async create(data) {
        await Assets.createFolder({ name: data.folder.name });
        data.files.forEach(async file => {
            Assets.CreateFile({
                name: `${file.name}`,
                content: file.name.split('.').pop() === 'json' ? JSON.stringify(file.content, null, '\t') : file.content
            }, data.folder.name);
        });
    }

    async createFolder(folder) {
        if (!folder) return;

        const folderPath = `${config.path.default}/${folder.name}`;

        if (!fs.existsSync(folderPath)) {
            fs.mkdirSync(folderPath);
            console.log(`[+] Folder '${folder.name}' created successfully.`);
        } else {
            console.warn(`[!] Folder '${folder.name}' already exists.`);
        }
    }

    async CreateFile(file, folderName) {
        if (!file) return;
        console.log(file);
        const filePath = `${config.path.default}\\${folderName}\\${file.name}`;

        if (!fs.existsSync(filePath)) {
            fs.writeFileSync(filePath, file.content || '');
            console.log(`[+] File '${file.name}' created successfully.`);
        } else {
            console.warn(`[!] File '${file.name}' already exists.`);
        }
    }
}

const Assets = new CreateAsset();


/*
// Example usage:

showNotification({
    title: "Update is avaliable",
    context: "New update (v1.0.5) is avaliable. Please check updates in settings",
    actions: [{
        title: 'Create',
        fn: () => {
            Assets.execute({
                type: "folder",
                data: {
                    folder: {
                            name: new Date().getTime()
                    },
                    files: [{
                        name: `${new Date().getTime()}.json`,
                        content: []
                    },{
                        name: 'logs.txt',
                        content: `[${new Date().toLocaleString()}] User created.\n`
                    },{
                        name: 'chats.json',
                        content: []
                    },{
                        name: 'hash.log',
                        content: `${Math.floor(Math.random() * new Date().getTime())}`
                    }]
                }
            })
        }
    }]
})

*/
