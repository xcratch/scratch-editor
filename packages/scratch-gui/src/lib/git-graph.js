const colors = ['#00a8ff', '#9c88ff', '#fbc531', '#4cd137', '#487eb0', '#e84118', '#8c7ae6', '#7f8fa6'];

export function computeGraphLayout(versions) {
    const layout = [];
    let activeBranches = [];

    for (let i = 0; i < versions.length; i++) {
        const v = versions[i];
        
        let pTs = v.parentTimestamp;
        // Fallback for backwards compatibility or missing data
        if (!pTs && i + 1 < versions.length) {
            pTs = versions[i + 1].timestamp;
        }
        
        let incomingLines = []; 
        let passingLines = [];
        let outgoingLines = []; 
        
        let colIndex = -1;
        
        const mergeCols = [];
        for (let c = 0; c < activeBranches.length; c++) {
            if (activeBranches[c] === v.timestamp) {
                mergeCols.push(c);
            }
        }
        
        const newActiveBranches = [...activeBranches];
        
        if (mergeCols.length > 0) {
            colIndex = mergeCols[0]; 
            for (const c of mergeCols) {
                incomingLines.push({ fromCol: c, toCol: colIndex, color: colors[c % colors.length] });
                if (c !== colIndex) {
                    newActiveBranches[c] = null; 
                }
            }
            newActiveBranches[colIndex] = pTs || null;
        } else {
            colIndex = newActiveBranches.findIndex(b => !b);
            if (colIndex === -1) colIndex = newActiveBranches.length;
            newActiveBranches[colIndex] = pTs || null;
        }
        
        if (pTs) {
            outgoingLines.push({ fromCol: colIndex, toCol: colIndex, color: colors[colIndex % colors.length] });
        } else {
            newActiveBranches[colIndex] = null;
        }
        
        for (let c = 0; c < newActiveBranches.length; c++) {
            if (newActiveBranches[c] && c !== colIndex) {
                passingLines.push({ col: c, color: colors[c % colors.length] });
            }
        }
        
        layout.push({
            nodeColumn: colIndex,
            nodeColor: colors[colIndex % colors.length],
            incomingLines,
            outgoingLines,
            passingLines
        });
        
        activeBranches = newActiveBranches;
    }
    
    return layout;
}
