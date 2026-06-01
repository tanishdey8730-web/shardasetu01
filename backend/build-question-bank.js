/**
 * Builds backend/data/question-bank.json from quizzes.json + exam-specific items.
 * Run: node backend/build-question-bank.js
 */
const fs = require("fs");
const path = require("path");

const quizzes = JSON.parse(
  fs.readFileSync(path.join(__dirname, "data", "quizzes.json"), "utf8")
);
const outPath = path.join(__dirname, "data", "question-bank.json");

const EXAMS = [
  { id: "ssc", name: "SSC", marksPerQuestion: 2, negativeMarks: 0.5 },
  { id: "ssc-cgl", name: "SSC CGL", marksPerQuestion: 2, negativeMarks: 0.5 },
  { id: "nda", name: "NDA", marksPerQuestion: 2.5, negativeMarks: 0.83 },
  { id: "cds", name: "CDS", marksPerQuestion: 1, negativeMarks: 0.33 },
  { id: "afcat", name: "AFCAT", marksPerQuestion: 3, negativeMarks: 1 },
  { id: "rrb-ntpc", name: "RRB NTPC", marksPerQuestion: 1, negativeMarks: 0.33 }
];

const CHAPTERS = [
  { id: "quant-percentage", examId: "ssc", subjectId: "quant", name: "Percentage & Ratio" },
  { id: "quant-arithmetic", examId: "ssc", subjectId: "quant", name: "Arithmetic & Number System" },
  { id: "quant-geometry", examId: "ssc", subjectId: "quant", name: "Geometry & Mensuration" },
  { id: "reasoning", examId: "ssc", subjectId: "reasoning", name: "Reasoning" },
  { id: "english", examId: "ssc", subjectId: "english", name: "English" },
  { id: "gs", examId: "ssc", subjectId: "gs", name: "General Awareness" },
  { id: "physics", examId: "nda", subjectId: "physics", name: "Physics" },
  { id: "chemistry", examId: "nda", subjectId: "chemistry", name: "Chemistry" },
  { id: "maths", examId: "nda", subjectId: "maths", name: "Mathematics" },
  { id: "english-cds", examId: "cds", subjectId: "english", name: "English" },
  { id: "gk-cds", examId: "cds", subjectId: "gk", name: "General Knowledge" },
  { id: "maths-cds", examId: "cds", subjectId: "maths", name: "Elementary Maths" },
  { id: "verbal-afcat", examId: "afcat", subjectId: "verbal", name: "Verbal Ability" },
  { id: "quant-afcat", examId: "afcat", subjectId: "quant", name: "Numerical Ability" },
  { id: "rrb-quant", examId: "rrb-ntpc", subjectId: "quant", name: "Mathematics" },
  { id: "rrb-reasoning", examId: "rrb-ntpc", subjectId: "reasoning", name: "Reasoning" },
  { id: "rrb-gs", examId: "rrb-ntpc", subjectId: "gs", name: "General Awareness" }
];

const SUBJECT_CHAPTER = {
  maths: "quant-arithmetic",
  physics: "physics",
  chemistry: "chemistry",
  "general-studies": "gs",
  aptitude: "quant-arithmetic",
  dsa: "quant-arithmetic",
  python: "quant-arithmetic"
};

const questions = [];
let n = 0;

function addQ(opts) {
  n += 1;
  questions.push({
    id: opts.id || `qb-${n}`,
    examId: opts.examId,
    subjectId: opts.subjectId,
    chapterId: opts.chapterId,
    chapterName: opts.chapterName,
    types: opts.types || ["chapter", "mock"],
    pyqYear: opts.pyqYear || null,
    pyqPaper: opts.pyqPaper || null,
    question: opts.question,
    options: opts.options,
    correct: opts.correct,
    marks: opts.marks ?? 2,
    negativeMarks: opts.negativeMarks ?? 0.5,
    explanation: opts.explanation || ""
  });
}

for (const [subject, items] of Object.entries(quizzes.quizzes || {})) {
  const chapterId = SUBJECT_CHAPTER[subject] || "quant-arithmetic";
  const ch = CHAPTERS.find((c) => c.id === chapterId) || CHAPTERS[0];
  const examIds =
    subject === "maths" || subject === "aptitude"
      ? ["ssc", "ssc-cgl", "rrb-ntpc"]
      : subject === "physics" || subject === "chemistry"
        ? ["nda", "cds", "afcat"]
        : ["ssc", "ssc-cgl"];
  for (const q of items) {
    for (const examId of examIds) {
      const exam = EXAMS.find((e) => e.id === examId) || EXAMS[0];
      addQ({
        id: `${q.id}-${examId}`,
        examId,
        subjectId: ch.subjectId,
        chapterId: ch.id,
        chapterName: ch.name,
        types: ["chapter", "mock"],
        question: q.question,
        options: q.options,
        correct: q.correct,
        marks: exam.marksPerQuestion,
        negativeMarks: exam.negativeMarks,
        explanation: q.explanation
      });
    }
  }
}

const PYQ_EXTRA = [
  {
    examId: "ssc-cgl",
    chapterId: "quant-percentage",
    chapterName: "Percentage & Ratio",
    subjectId: "quant",
    pyqYear: 2023,
    pyqPaper: "SSC CGL Tier-1",
    question: "If A is 20% more than B, then B is how much percent less than A?",
    options: ["16.66%", "20%", "25%", "33.33%"],
    correct: 0,
    explanation: "B = 100, A = 120. B is (20/120)×100 = 16.66% less than A."
  },
  {
    examId: "ssc-cgl",
    chapterId: "quant-arithmetic",
    chapterName: "Arithmetic",
    subjectId: "quant",
    pyqYear: 2022,
    pyqPaper: "SSC CGL Tier-1",
    question: "A can do a work in 12 days and B in 18 days. They work together for 4 days. Fraction of work left?",
    options: ["4/9", "5/9", "7/9", "8/9"],
    correct: 0,
    explanation: "Together rate = 1/12+1/18 = 5/36. In 4 days = 20/36 = 5/9 done. Left = 4/9."
  },
  {
    examId: "nda",
    chapterId: "maths",
    chapterName: "Mathematics",
    subjectId: "maths",
    pyqYear: 2023,
    pyqPaper: "NDA I",
    question: "If sin²θ + cos²θ = 1, then tan²θ + 1 equals:",
    options: ["sin²θ", "cos²θ", "sec²θ", "cot²θ"],
    correct: 2,
    explanation: "tan²θ + 1 = sec²θ (standard identity)."
  },
  {
    examId: "cds",
    chapterId: "english-cds",
    chapterName: "English",
    subjectId: "english",
    pyqYear: 2023,
    pyqPaper: "CDS I",
    question: "Choose the correctly spelt word:",
    options: ["Accomodation", "Accommodation", "Acommodation", "Acomodation"],
    correct: 1,
    explanation: "Correct spelling: Accommodation (double c, double m)."
  },
  {
    examId: "rrb-ntpc",
    chapterId: "rrb-gs",
    chapterName: "General Awareness",
    subjectId: "gs",
    pyqYear: 2022,
    pyqPaper: "RRB NTPC CBT-1",
    question: "Which organelle is known as the powerhouse of the cell?",
    options: ["Nucleus", "Ribosome", "Mitochondria", "Golgi body"],
    correct: 2,
    explanation: "Mitochondria produce ATP through cellular respiration."
  },
  {
    examId: "afcat",
    chapterId: "verbal-afcat",
    chapterName: "Verbal Ability",
    subjectId: "verbal",
    pyqYear: 2023,
    pyqPaper: "AFCAT",
    question: "Antonym of 'ABUNDANT' is:",
    options: ["Plentiful", "Scarce", "Ample", "Copious"],
    correct: 1,
    explanation: "Abundant means plentiful; scarce is the opposite."
  }
];

for (const p of PYQ_EXTRA) {
  const exam = EXAMS.find((e) => e.id === p.examId) || EXAMS[0];
  addQ({
    ...p,
    types: ["pyq", "chapter", "mock"],
    marks: exam.marksPerQuestion,
    negativeMarks: exam.negativeMarks
  });
}

const MOCK_TEMPLATES = [
  {
    id: "ssc-cgl-mock-full-1",
    title: "SSC CGL Full Mock Test 1",
    examId: "ssc-cgl",
    type: "mock",
    durationMinutes: 60,
    questionCount: 25,
    negativeMarks: 0.5,
    marksPerQuestion: 2,
    description: "Full-length practice paper — Quant, Reasoning, English & GS mix"
  },
  {
    id: "ssc-cgl-mock-full-2",
    title: "SSC CGL Full Mock Test 2",
    examId: "ssc-cgl",
    type: "mock",
    durationMinutes: 60,
    questionCount: 25,
    negativeMarks: 0.5,
    marksPerQuestion: 2,
    description: "Second full mock with new question set"
  },
  {
    id: "nda-mock-full-1",
    title: "NDA Full Mock Test 1",
    examId: "nda",
    type: "mock",
    durationMinutes: 45,
    questionCount: 20,
    negativeMarks: 0.83,
    marksPerQuestion: 2.5,
    description: "Maths + GAT combined mock"
  },
  {
    id: "rrb-ntpc-mock-1",
    title: "RRB NTPC Full Mock 1",
    examId: "rrb-ntpc",
    type: "mock",
    durationMinutes: 90,
    questionCount: 30,
    negativeMarks: 0.33,
    marksPerQuestion: 1,
    description: "CBT-1 style full mock"
  }
];

const bank = {
  version: 1,
  exams: EXAMS,
  chapters: CHAPTERS,
  mockTemplates: MOCK_TEMPLATES,
  questions
};

fs.writeFileSync(outPath, JSON.stringify(bank, null, 2));
console.log(`Wrote ${questions.length} questions to question-bank.json`);
