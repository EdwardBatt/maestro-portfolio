import type {
  FullConfig, FullResult, Reporter, Suite, TestCase, TestResult
} from '@playwright/test/reporter';
import fs from 'fs';
import path from 'path';

class MarkdownReporter implements Reporter {
  private markdownPath = path.resolve('docs', 'RETEST-REDESIGN.md');

  onTestEnd(test: TestCase, result: TestResult) {
    if (result.status === 'passed' || result.status === 'failed') {
      // Extract the step ID from the test title. E.g., "A1 - As a manager..." -> "A1"
      const match = test.title.match(/^([A-Z]\d+[a-z]?)\b/);
      if (match) {
        const stepId = match[1];
        let content = fs.readFileSync(this.markdownPath, 'utf8');
        
        // Find the line that matches `- [ ] **StepID**` or `- [ ] **StepID [Date]**`
        const regex = new RegExp(`^- \\[[ xX]\\] \\*\\*${stepId}(?: \\[.*?\\])?\\*\\*.*`, 'gm');
        
        content = content.replace(regex, (matchedLine) => {
          if (result.status === 'passed') {
            return matchedLine.replace(/^- \[[ xX]\]/, '- [X]');
          } else {
            // Check if error is already appended to avoid duplicates if retried
            const errorText = `\nError: <details>\n${result.error?.message?.replace(/\n/g, '\n    ') || 'Test failed'}\n</details>`;
            if (!matchedLine.includes('Error: <details>')) {
              return matchedLine + errorText;
            }
            return matchedLine;
          }
        });
        
        fs.writeFileSync(this.markdownPath, content, 'utf8');
      }
    }
  }
}

export default MarkdownReporter;
