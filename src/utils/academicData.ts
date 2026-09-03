import { StudentProfile } from '../types';

export interface DepartmentOption {
  id: string;
  code: string;
  name: string;
}

export const ACADEMIC_DEPARTMENTS: DepartmentOption[] = [
  { id: 'CS', code: 'CS', name: 'Computer Science (CS)' },
  { id: 'CSDS', code: 'CSDS', name: 'Computer Science with Data Science (CSDS)' },
  { id: 'CSAI', code: 'CSAI', name: 'Computer Science with Artificial Intelligence (CSAI)' },
  { id: 'BCA', code: 'BCA', name: 'BCA' },
  { id: 'B.Com', code: 'B.Com', name: 'B.Com' },
  { id: 'English', code: 'English', name: 'English' },
  { id: 'Mathematics', code: 'Mathematics', name: 'Mathematics' },
  { id: 'Physics', code: 'Physics', name: 'Physics' },
  { id: 'Chemistry', code: 'Chemistry', name: 'Chemistry' },
];

export const CLASS_LEVELS = ['I', 'II', 'III'];

// Helper to get list of classes for a given department
export const getClassesForDepartment = (deptCodeOrId: string): string[] => {
  const code = getDeptCode(deptCodeOrId);
  return CLASS_LEVELS.map(level => `${code} - ${level}`);
};

export const ALL_ACADEMIC_CLASSES: string[] = ACADEMIC_DEPARTMENTS.flatMap(d => 
  CLASS_LEVELS.map(level => `${d.code} - ${level}`)
);

export const getDeptCode = (deptStr: string): string => {
  if (!deptStr) return 'CS';
  const str = deptStr.trim();
  const lower = str.toLowerCase();
  if (lower.includes('data') || lower === 'cs_ds' || lower === 'csds') return 'CSDS';
  if (lower.includes('ai') || lower === 'cs_ai' || lower === 'csai') return 'CSAI';
  if (lower === 'bca') return 'BCA';
  if (lower === 'bcom' || lower === 'b.com') return 'B.Com';
  if (lower === 'english') return 'English';
  if (lower === 'mathematics' || lower === 'maths') return 'Mathematics';
  if (lower === 'physics') return 'Physics';
  if (lower === 'chemistry') return 'Chemistry';
  if (lower === 'computer_science' || lower === 'cs' || lower === 'cse') return 'CS';
  
  const found = ACADEMIC_DEPARTMENTS.find(d => d.id === str || d.code === str || d.name === str);
  if (found) return found.code;

  return str.toUpperCase();
};

export const getDeptName = (deptStr: string): string => {
  const code = getDeptCode(deptStr);
  const found = ACADEMIC_DEPARTMENTS.find(d => d.code === code);
  return found ? found.name : deptStr;
};

// Returns standard class string like "CSDS - II" for any student record
export const getStudentAssignedClass = (s: StudentProfile): string => {
  if (!s) return 'CS - I';
  if ((s as any).assignedClass) return (s as any).assignedClass;

  const deptCode = getDeptCode(s.department || '');
  
  const y = (s.year || '').toString().toLowerCase();
  let yearCode = 'I';
  if (y.includes('2') || y.includes('ii') || y.includes('second')) yearCode = 'II';
  else if (y.includes('3') || y.includes('iii') || y.includes('third')) yearCode = 'III';

  return `${deptCode} - ${yearCode}`;
};
