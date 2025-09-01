// Change tracking utilities for field-level change detection

export interface FieldChange {
  field: string;
  oldValue: any;
  newValue: any;
  label: string;
}

export interface CompareResult {
  hasChanges: boolean;
  changes: FieldChange[];
  changedFields: string[];
}

// Field labels for better display
export const PLANT_CODE_LABELS: Record<string, string> = {
  companyCode: 'Company Code',
  plantCode: 'Plant Code',
  nameOfPlant: 'Name of Plant',
  addressOfPlant: 'Address of Plant',
  purchaseOrganization: 'Purchase Organization',
  nameOfPurchaseOrganization: 'Name of Purchase Organization',
  salesOrganization: 'Sales Organization',
  nameOfSalesOrganization: 'Name of Sales Organization',
  profitCenter: 'Profit Center',
  nameOfProfitCenter: 'Name of Profit Center',
  costCenters: 'Cost Centers',
  nameOfCostCenters: 'Name of Cost Centers',
  projectCode: 'Project Code',
  projectCodeDescription: 'Project Code Description',
  storageLocationCode: 'Storage Location Code',
  storageLocationDescription: 'Storage Location Description',
  gstCertificate: 'GST Certificate'
};

export const COMPANY_CODE_LABELS: Record<string, string> = {
  companyCode: 'Company Code',
  nameOfCompanyCode: 'Name of Company Code',
  shareholdingPercentage: 'Shareholding Percentage',
  segment: 'Segment',
  nameOfSegment: 'Name of Segment',
  gstCertificate: 'GST Certificate',
  cin: 'CIN',
  pan: 'PAN'
};

export function compareObjects(oldObj: any, newObj: any, type: 'plant' | 'company'): CompareResult {
  const labels = type === 'plant' ? PLANT_CODE_LABELS : COMPANY_CODE_LABELS;
  const changes: FieldChange[] = [];
  const changedFields: string[] = [];

  // Get all possible fields from both objects
  const allFields = new Set([...Object.keys(oldObj || {}), ...Object.keys(newObj || {})]);

  for (const field of allFields) {
    // Skip metadata fields
    if (['requestId', 'version', 'createdAt', 'updatedAt'].includes(field)) {
      continue;
    }

    const oldValue = oldObj?.[field];
    const newValue = newObj?.[field];

    // Convert values to strings for comparison to handle different types
    const oldStr = String(oldValue ?? '');
    const newStr = String(newValue ?? '');

    if (oldStr !== newStr) {
      changes.push({
        field,
        oldValue: oldValue ?? '',
        newValue: newValue ?? '',
        label: labels[field] || field
      });
      changedFields.push(field);
    }
  }

  return {
    hasChanges: changes.length > 0,
    changes,
    changedFields
  };
}

export function formatChangesForNotification(changes: FieldChange[]): string {
  if (changes.length === 0) return 'No changes detected';

  if (changes.length === 1) {
    const change = changes[0];
    return `Changed ${change.label}: "${change.oldValue}" → "${change.newValue}"`;
  }

  const fieldNames = changes.map(c => c.label).join(', ');
  return `Changed ${changes.length} fields: ${fieldNames}`;
}

export function generateChangesSummary(changes: FieldChange[]): string {
  return changes.map(change => 
    `• ${change.label}: "${change.oldValue}" → "${change.newValue}"`
  ).join('\n');
}

// Explicit re-exports (some bundlers are picky)
export {
  compareObjects as _compareObjects,
  formatChangesForNotification as _formatChangesForNotification,
  generateChangesSummary as _generateChangesSummary,
};

// Optional default export for maximum compatibility
export default {
  compareObjects,
  formatChangesForNotification,
  generateChangesSummary,
  PLANT_CODE_LABELS,
  COMPANY_CODE_LABELS,
};
