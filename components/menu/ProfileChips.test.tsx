import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import ProfileChips from './ProfileChips';

describe('ProfileChips', () => {
  it('edits a fact in place: click, type, Enter', () => {
    const onChange = vi.fn();
    render(<ProfileChips profile={{ name: 'Maya', age: 27 }} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: /Name: Maya/ }));
    const input = screen.getByLabelText('Name');
    fireEvent.change(input, { target: { value: 'Maya Patel' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onChange).toHaveBeenCalledWith({ name: 'Maya Patel', age: 27 });
  });

  it('offers the missing basics as "+ add" and keeps age a sensible number', () => {
    const onChange = vi.fn();
    render(<ProfileChips profile={{}} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: /Age: not set/ }));
    const input = screen.getByLabelText('Age');
    fireEvent.change(input, { target: { value: '200' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onChange).toHaveBeenLastCalledWith({});
    fireEvent.click(screen.getByRole('button', { name: /Age: not set/ }));
    fireEvent.change(screen.getByLabelText('Age'), { target: { value: '31' } });
    fireEvent.blur(screen.getByLabelText('Age'));
    expect(onChange).toHaveBeenLastCalledWith({ age: 31 });
  });

  it('clears a fact when emptied, and Escape cancels an edit', () => {
    const onChange = vi.fn();
    render(<ProfileChips profile={{ location: 'Leeds' }} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: /Lives in: Leeds/ }));
    fireEvent.keyDown(screen.getByLabelText('Lives in'), { key: 'Escape' });
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /Lives in: Leeds/ }));
    fireEvent.change(screen.getByLabelText('Lives in'), { target: { value: '  ' } });
    fireEvent.keyDown(screen.getByLabelText('Lives in'), { key: 'Enter' });
    expect(onChange).toHaveBeenCalledWith({});
  });

  it('picks risk from the three allowed values', () => {
    const onChange = vi.fn();
    render(<ProfileChips profile={{ risk_tolerance: 'balanced' }} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: /With risk: balanced/ }));
    fireEvent.change(screen.getByLabelText('With risk'), { target: { value: 'bold' } });
    fireEvent.blur(screen.getByLabelText('With risk'));
    expect(onChange).toHaveBeenCalledWith({ risk_tolerance: 'bold' });
  });
});
